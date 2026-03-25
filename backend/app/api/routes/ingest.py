"""
Ingestion routes.

POST /ingest/metrics  — Prometheus remote_write receiver
POST /ingest/logs     — Log signal ingestion

Both endpoints:
  1. Validate the incoming payload against canonical schemas
  2. Upsert the cluster_metric_registry / cluster_log_registry
  3. Store the raw metric/signal for baseline computation
  4. Update cluster.last_metric_received_at / last_log_received_at
  5. Update cluster.current_status freshness flag if gap detected
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from datetime import datetime, timezone
from app.db.session import get_db
from app.models.models import (
    Cluster, ClusterMetricRegistry, ClusterLogRegistry,
    LogSignal, DataFreshness, HealthStatus
)
from app.schemas.schemas import (
    PrometheusWriteRequest, CanonicalLogSignal, CanonicalMetric
)
from app.core.config import get_settings

settings = get_settings()
router = APIRouter()


# ── Metric name normalisation ────────────────────────────────────────────────
# Maps Prometheus metric names (as customers send them) to canonical names.
# This is the ES-specific normalisation table.
# When we add MySQL, we add a mysql_metric_map here.

ES_METRIC_MAP: dict[str, dict] = {
    # JVM
    "elasticsearch_jvm_memory_used_bytes":         {"canonical": "jvm.heap.used.percent",      "category": "jvm",  "unit": "percent"},
    "elasticsearch_jvm_memory_heap_used_percent":  {"canonical": "jvm.heap.used.percent",      "category": "jvm",  "unit": "percent"},
    "jvm_memory_heap_used_ratio":                  {"canonical": "jvm.heap.used.percent",      "category": "jvm",  "unit": "percent"},
    "elasticsearch_jvm_gc_collection_seconds_sum": {"canonical": "gc.old.collection.seconds",  "category": "jvm",  "unit": "seconds"},
    "elasticsearch_jvm_gc_collection_count_total": {"canonical": "gc.old.collection.count",    "category": "jvm",  "unit": "count"},
    # Thread pool
    "elasticsearch_thread_pool_rejected_count_total": {"canonical": "thread_pool.write.rejected", "category": "io", "unit": "count"},
    "elasticsearch_thread_pool_queue_count":          {"canonical": "thread_pool.write.queue",    "category": "io", "unit": "count"},
    # Shards
    "elasticsearch_cluster_health_unassigned_shards": {"canonical": "cluster.shards.unassigned", "category": "shard", "unit": "count"},
    "elasticsearch_cluster_health_status":            {"canonical": "cluster.health.status",      "category": "shard", "unit": "count"},
    # Disk
    "elasticsearch_filesystem_data_available_bytes": {"canonical": "fs.total.available.bytes",   "category": "disk", "unit": "bytes"},
    "elasticsearch_filesystem_data_size_bytes":      {"canonical": "fs.total.total.bytes",        "category": "disk", "unit": "bytes"},
    # Search
    "elasticsearch_indices_search_query_time_seconds_total": {"canonical": "search.query.time.ms",   "category": "search", "unit": "ms"},
    "elasticsearch_indices_search_query_total":              {"canonical": "search.query.total",      "category": "search", "unit": "count"},
}


def normalise_metric(source_name: str, labels: dict[str, str]) -> dict | None:
    """
    Look up a source metric name in the normalisation map.
    Returns the canonical mapping or None if unknown.
    """
    return ES_METRIC_MAP.get(source_name)


def extract_cluster_id(labels: dict[str, str]) -> str | None:
    """
    Extract cluster identifier from Prometheus labels.
    Customers tag their metrics with cluster or job labels.
    """
    return labels.get("cluster") or labels.get("job") or labels.get("instance")


# ── GET or create cluster ─────────────────────────────────────────────────────

async def get_or_create_cluster(
    db: AsyncSession,
    cluster_id: str,
    db_type: str = "elasticsearch",
) -> Cluster:
    stmt = select(Cluster).where(Cluster.cluster_id == cluster_id)
    cluster = (await db.execute(stmt)).scalar_one_or_none()

    if not cluster:
        cluster = Cluster(
            cluster_id=cluster_id,
            db_type=db_type,
            display_name=cluster_id,
            current_status=HealthStatus.unknown,
        )
        db.add(cluster)
        await db.flush()  # Get the UUID without committing

    return cluster


async def upsert_metric_registry(
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
        entry = ClusterMetricRegistry(
            cluster_id=cluster.id,
            canonical_name=canonical_name,
            source_metric_name=source_name,
            category=category,
            unit=unit,
            first_seen_at=now,
            last_seen_at=now,
            is_active=True,
        )
        db.add(entry)


# ── POST /ingest/metrics ──────────────────────────────────────────────────────

@router.post("/metrics", status_code=status.HTTP_204_NO_CONTENT)
async def ingest_metrics(
    payload: PrometheusWriteRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Receives Prometheus remote_write payloads.
    Normalises metric names, upserts the registry, stamps last_metric_received_at.

    Customers configure Prometheus remote_write to point here:
      remote_write:
        - url: https://your-platform/ingest/metrics
    """
    now = datetime.now(timezone.utc)
    processed = 0

    for ts in payload.timeseries:
        labels = {l.name: l.value for l in ts.labels}
        source_name = labels.get("__name__", "")
        cluster_id = extract_cluster_id(labels)

        if not cluster_id or not source_name:
            continue

        mapping = normalise_metric(source_name, labels)
        if not mapping:
            # Unknown metric — still register it so user can see what's arriving
            # but we can't baseline or analyze it until we add it to the map
            continue

        cluster = await get_or_create_cluster(db, cluster_id)
        cluster.last_metric_received_at = now

        await upsert_metric_registry(
            db, cluster,
            source_name,
            mapping["canonical"],
            mapping["category"],
            mapping["unit"],
        )
        processed += 1

    # NOTE: Raw metric values are NOT stored here.
    # The baseline engine reads directly from Prometheus/Grafana API
    # or a separate time-series buffer. We store only the registry and baselines.
    # This keeps storage costs minimal — a core architectural constraint.

    return None


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
        cluster = await get_or_create_cluster(db, signal.cluster_id, signal.db_type)
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

    return None
