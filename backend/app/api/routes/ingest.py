"""
Ingestion routes.

POST /ingest/metrics  — Push metrics receiver (JSON format, bearer token auth)
POST /ingest/logs     — Log signal ingestion (unchanged)

Push flow:
  1. Validate bearer token → (tenant_id, stack_id)
  2. Parse JSON payload
  3. Auto-create cluster if unknown (linked to stack → tenant)
  4. Normalise raw metric names via DB-backed normalisation_map
  5. Derive computed metrics (heap%, connection%, disk%)
  6. Upsert cluster_metric_registry
  7. Record unknown metrics to unmapped_metrics
  8. Enqueue AnalysisJob → worker runs intelligence pipeline async
  9. Return 202 Accepted

Design:
  - 202 Accepted — HTTP response never waits for analysis
  - Normalisation map loaded from DB with 5-minute TTL cache
  - Hardcoded ES_METRIC_MAP removed — DB is single source of truth
  - stack_id set on auto-created clusters — tenant isolation correct
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.ingest.auth import get_bearer_credentials, validate_bearer_token
from app.ingest.derived import apply_derived_rules
from app.ingest.normaliser import load_norm_map, normalise_batch, record_unmapped
from app.ingest.queue import AnalysisJob, enqueue
from app.models.models import (
    Cluster, ClusterLogRegistry, ClusterMetricRegistry,
    DataFreshness, DbType, HealthStatus, LogSignal, SourceType,
)
from app.schemas.schemas import CanonicalLogSignal

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Push ingest payload schema ────────────────────────────────────────────────

class PushMetricsPayload(BaseModel):
    """
    Simple JSON push format. Prometheus remote_write protobuf comes in Phase 2.5.

    cluster_id: composite string key, e.g. "Alpha|us-east1|els_shrdone_alpha_va"
    db_type:    "elasticsearch" | "mysql" | "postgres" | "cassandra"
    timestamp:  ISO-8601 UTC timestamp of when the metrics were collected
    metrics:    {raw_metric_name: float_value} — cluster-level aggregates
    instances:  optional {instance_id: {raw_metric_name: float_value}} — per-node breakdowns
    """
    cluster_id: str
    db_type: str
    timestamp: datetime
    metrics: dict[str, float] = {}
    instances: dict[str, dict[str, float]] = {}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_or_create_cluster(
    db: AsyncSession,
    cluster_id: str,
    db_type: DbType,
    stack_id,
) -> Cluster:
    """
    Look up cluster by composite string key. Auto-create if not found.
    stack_id is always set — ensures tenant isolation chain is intact.
    """
    stmt = select(Cluster).where(Cluster.cluster_id == cluster_id)
    cluster = (await db.execute(stmt)).scalar_one_or_none()

    if cluster is None:
        display_name = cluster_id.split("|")[-1] if "|" in cluster_id else cluster_id
        cluster = Cluster(
            cluster_id=cluster_id,
            db_type=db_type,
            stack_id=stack_id,
            display_name=display_name,
            current_status=HealthStatus.unknown,
        )
        db.add(cluster)
        await db.flush()
        logger.info(f"Auto-created cluster '{cluster_id}' from push payload")

    return cluster


async def _upsert_metric_registry(
    db: AsyncSession,
    cluster: Cluster,
    source_name: str,
    canonical_name: str,
    category: str,
    unit: str,
) -> None:
    stmt = select(ClusterMetricRegistry).where(
        and_(
            ClusterMetricRegistry.cluster_id == cluster.id,
            ClusterMetricRegistry.source_metric_name == source_name,
        )
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    now = datetime.now(timezone.utc)

    if existing:
        existing.last_seen_at = now
        existing.is_active = True
    else:
        db.add(ClusterMetricRegistry(
            cluster_id=cluster.id,
            canonical_name=canonical_name,
            source_metric_name=source_name,
            category=category,
            unit=unit,
            first_seen_at=now,
            last_seen_at=now,
            is_active=True,
        ))


# ── POST /ingest/metrics ──────────────────────────────────────────────────────

@router.post("/metrics", status_code=status.HTTP_202_ACCEPTED)
async def ingest_metrics(
    payload: PushMetricsPayload,
    db: AsyncSession = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Security(get_bearer_credentials),
):
    """
    Push metrics receiver. Accepts canonical JSON payload from customer agents.
    Returns 202 immediately — analysis runs asynchronously via the worker queue.
    """
    # 1. Auth — validate bearer token, get tenant + stack context
    token_record = await validate_bearer_token(db, credentials)
    tenant_id = token_record.tenant_id
    stack_id = token_record.stack_id

    # 2. Parse db_type
    try:
        db_type = DbType(payload.db_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown db_type '{payload.db_type}'. Valid: {[e.value for e in DbType]}",
        )

    if not payload.metrics and not payload.instances:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Payload must include at least one of 'metrics' or 'instances'",
        )

    received_at = datetime.now(timezone.utc)

    # 3. Auto-create cluster if unknown
    cluster = await _get_or_create_cluster(db, payload.cluster_id, db_type, stack_id)
    cluster.last_metric_received_at = received_at

    # 4. Load normalisation map from DB (TTL-cached, falls back to grafana_cloud entries)
    norm_map = await load_norm_map(db, SourceType.push, db_type)

    # 5. Normalise cluster-level metrics
    canonical_metrics, unmapped_names = normalise_batch(payload.metrics, norm_map)

    # Record unmapped metrics for product team review
    for raw_name in unmapped_names:
        sample_value = payload.metrics.get(raw_name, 0.0)
        await record_unmapped(db, tenant_id, stack_id, SourceType.push, db_type, raw_name, sample_value)

    # 6. Compute derived metrics (heap%, disk%, connection%)
    canonical_metrics = apply_derived_rules(canonical_metrics, db_type)

    # 7. Normalise per-instance metrics
    per_instance_canonical: dict[str, dict[str, float]] = {}
    for instance_id, instance_raw in payload.instances.items():
        inst_canonical, inst_unmapped = normalise_batch(instance_raw, norm_map)
        inst_canonical = apply_derived_rules(inst_canonical, db_type)
        per_instance_canonical[instance_id] = inst_canonical
        # Record per-instance unmapped metrics too
        for raw_name in inst_unmapped:
            sample_value = instance_raw.get(raw_name, 0.0)
            await record_unmapped(db, tenant_id, stack_id, SourceType.push, db_type, raw_name, sample_value)

    # 8. Upsert metric registry for all known metrics
    for raw_name, entry in norm_map.items():
        if raw_name in payload.metrics:
            await _upsert_metric_registry(
                db, cluster, raw_name,
                entry.canonical_name, entry.category, entry.unit,
            )

    await db.commit()

    # 9. Enqueue analysis job — response does not wait for this
    job = AnalysisJob(
        tenant_id=tenant_id,
        stack_id=stack_id,
        cluster_id=payload.cluster_id,
        db_type=db_type,
        metrics=canonical_metrics,
        per_instance=per_instance_canonical,
        received_at=received_at,
    )
    await enqueue(job)

    logger.info(
        f"Push ingest accepted — cluster={payload.cluster_id} "
        f"canonical={len(canonical_metrics)} unmapped={len(unmapped_names)} "
        f"instances={len(per_instance_canonical)}"
    )

    return {
        "status": "accepted",
        "cluster_id": payload.cluster_id,
        "canonical_metrics_received": len(canonical_metrics),
        "unmapped_metrics": len(unmapped_names),
    }


# ── POST /ingest/logs ─────────────────────────────────────────────────────────

@router.post("/logs", status_code=status.HTTP_204_NO_CONTENT)
async def ingest_log_signals(
    signals: list[CanonicalLogSignal],
    db: AsyncSession = Depends(get_db),
):
    """
    Receives extracted log signals. Raw log lines are never sent — customers
    run a lightweight extractor (or our agent) that extracts signals locally
    before pushing here. This keeps data egress minimal and privacy-safe.
    """
    now = datetime.now(timezone.utc)

    for signal in signals:
        # Resolve cluster by cluster_id string
        stmt = select(Cluster).where(Cluster.cluster_id == signal.cluster_id)
        cluster = (await db.execute(stmt)).scalar_one_or_none()
        if cluster is None:
            logger.warning(f"Log signal received for unknown cluster '{signal.cluster_id}' — skipping")
            continue

        cluster.last_log_received_at = now

        # Upsert log registry
        stmt = select(ClusterLogRegistry).where(
            and_(
                ClusterLogRegistry.cluster_id == cluster.id,
                ClusterLogRegistry.signal_type == signal.signal_type,
            )
        )
        existing_registry = (await db.execute(stmt)).scalar_one_or_none()
        if existing_registry:
            existing_registry.last_seen_at = now
            existing_registry.is_active = True
        else:
            db.add(ClusterLogRegistry(
                cluster_id=cluster.id,
                signal_type=signal.signal_type,
                source_platform=signal.source_platform,
                is_active=True,
                first_seen_at=now,
                last_seen_at=now,
            ))

        # Store the extracted signal for correlation
        db.add(LogSignal(
            cluster_id=cluster.id,
            signal_type=signal.signal_type,
            severity=signal.severity,
            count=signal.count,
            window_start=signal.window_start,
            window_end=signal.window_end,
            source_platform=signal.source_platform,
        ))

    await db.commit()
    return None
