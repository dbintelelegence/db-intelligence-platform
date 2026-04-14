"""
Analyzer Runner — Step 5

Orchestrates one full analysis cycle for a cluster:
  1. Fetch current metric values via adapter.get_latest_metrics()
  2. Load baseline profiles from DB
  3. Run each registered analyzer
  4. Write verdict row (append-only)
  5. Update cluster.current_status (denormalised fast-read field)
  6. If status changed → placeholder for LLM explanation (Step 6)

Usage:
    cd backend
    python -m app.runner.analyzer_runner

Design constraints (from CLAUDE.md):
  - Append-only verdicts — never UPDATE verdicts table
  - LLM called only on status change — checked here, stub for now
  - Tenant isolation — all queries include cluster UUID scoped to tenant
  - No raw metrics stored — values used in-memory only
"""

import asyncio
import logging
import sys
from datetime import datetime, timezone

from sqlalchemy import select, and_, desc

from app.adapters.grafana_cloud.adapter import GrafanaCloudAdapter
from app.analyzers.elasticsearch.jvm_heap_pressure import JvmHeapPressureAnalyzer
from app.analyzers.elasticsearch.shard_allocation import ShardAllocationAnalyzer
from app.analyzers.elasticsearch.thread_pool_saturation import ThreadPoolSaturationAnalyzer
from app.analyzers.mysql.connection_pool_saturation import ConnectionPoolSaturationAnalyzer
from app.analyzers.mysql.replication_lag import ReplicationLagAnalyzer
from app.analyzers.mysql.innodb_buffer_pool_pressure import (
    InnodbBufferPoolPressureAnalyzer, PER_INSTANCE_METRICS,
)
from app.baseline.engine import WINDOW_ALL, get_baselines_for_cluster
from app.core.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.models import (
    Cluster, DataFreshness, DbType, HealthStatus, Verdict, VerdictEvidence,
)
from app.runner.llm_explainer import generate_explanation

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()

# ── Target clusters ───────────────────────────────────────────────────────────

DEFAULT_CLUSTER_ID = "Alpha|us-east1|els_shrdone_alpha_va"

ALL_ALPHA_CLUSTERS = [
    "Alpha|us-east1|els_shrdegt_alpha_va",
    "Alpha|us-east1|els_shrdone_alpha_va",
    "Alpha|us-east1|els_shrdsix_alpha_va",
    "Alpha|us-east1|els_shrdsvn_alpha_va",
    "Alpha|us-east1|els_sixna_alpha_va",
]

MYSQL_ALPHA_CLUSTERS = [
    "Alpha|us-east1|mysql_aa_alpha",
    "Alpha|us-east1|mysql_bigaa_alpha",
    "Alpha|us-east1|mysql_mng_alpha",
    "Alpha|us-east1|mysql_sharedaa_alpha",
]

# ── Registered analyzers — organized by DB type ───────────────────────────────

ES_ANALYZERS = [
    JvmHeapPressureAnalyzer(),
    ShardAllocationAnalyzer(),
    ThreadPoolSaturationAnalyzer(),
]

MYSQL_ANALYZERS = [
    ConnectionPoolSaturationAnalyzer(),
    ReplicationLagAnalyzer(),
    InnodbBufferPoolPressureAnalyzer(),
]

ANALYZERS_BY_DB_TYPE = {
    DbType.elasticsearch: ES_ANALYZERS,
    DbType.mysql: MYSQL_ANALYZERS,
}


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_prev_status(
    db,
    cluster_uuid,
    analyzer_name: str,
    instance_id: str | None = None,
) -> HealthStatus | None:
    """Fetch the most recent verdict status for this cluster + analyzer (+ instance if set)."""
    conditions = [
        Verdict.cluster_id == cluster_uuid,
        Verdict.analyzer_name == analyzer_name,
    ]
    if instance_id is not None:
        conditions.append(Verdict.instance_id == instance_id)
    else:
        conditions.append(Verdict.instance_id.is_(None))

    stmt = (
        select(Verdict.status)
        .where(and_(*conditions))
        .order_by(desc(Verdict.run_at))
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    return row


async def _write_verdict(
    db,
    cluster_uuid,
    result,
    prev_status: HealthStatus | None,
    run_at: datetime,
) -> Verdict:
    """Insert a new verdict row with evidence items. Never updates existing rows."""
    now = datetime.now(timezone.utc)

    lag_seconds = None
    freshness = DataFreshness.fresh
    if result.metric_ts:
        lag = (run_at - result.metric_ts).total_seconds()
        lag_seconds = int(lag)
        if lag > 300:
            freshness = DataFreshness.delayed

    verdict = Verdict(
        cluster_id=cluster_uuid,
        analyzer_name=result.analyzer_name,
        instance_id=result.instance_id,
        status=result.status,
        prev_status=prev_status,
        observed=result.observed,
        baseline_summary=result.baseline_summary,
        root_cause=result.root_cause,
        recommendation=result.recommendation,
        confidence=result.confidence,
        metric_ts=result.metric_ts,
        ingested_at=now,
        run_at=run_at,
        data_freshness=freshness,
        lag_seconds=lag_seconds,
    )
    db.add(verdict)
    await db.flush()  # get verdict.id without committing yet

    for item in result.evidence:
        db.add(VerdictEvidence(
            verdict_id=verdict.id,
            evidence_text=item.text,
            source_type=item.source_type,
            confidence_delta=item.confidence_delta,
        ))

    return verdict


async def _update_cluster_status(db, cluster_uuid, worst_status: HealthStatus) -> None:
    """Update the denormalised current_status on the clusters row."""
    stmt = select(Cluster).where(Cluster.id == cluster_uuid)
    cluster = (await db.execute(stmt)).scalar_one()
    cluster.current_status = worst_status


def _worst_status(*statuses: HealthStatus) -> HealthStatus:
    """Return the most severe status from a list."""
    order = [HealthStatus.critical, HealthStatus.degraded, HealthStatus.healthy, HealthStatus.unknown]
    for s in order:
        if s in statuses:
            return s
    return HealthStatus.unknown


# ── Main ──────────────────────────────────────────────────────────────────────

async def run_cluster(db, cluster_composite_id: str, run_at: datetime) -> None:
    """Run a full analysis cycle for a single cluster."""
    logger.info(f"\n── Analyzing {cluster_composite_id} ──")

    # 1. Resolve composite string key → UUID + db_type
    stmt = select(Cluster).where(Cluster.cluster_id == cluster_composite_id)
    cluster = (await db.execute(stmt)).scalar_one_or_none()
    if cluster is None:
        logger.error(f"Cluster not found in DB: {cluster_composite_id}")
        return
    cluster_uuid = cluster.id

    # 2. Select analyzers and build adapter for this db_type
    analyzers = ANALYZERS_BY_DB_TYPE.get(cluster.db_type, [])
    if not analyzers:
        logger.warning(f"  No analyzers registered for db_type={cluster.db_type} — skipping")
        return

    adapter = GrafanaCloudAdapter(
        prometheus_url=settings.grafana_gcp_prod_url,
        instance_id=settings.grafana_gcp_prod_instance_id,
        api_key=settings.grafana_gcp_prod_api_key,
        db=db,
        db_type=cluster.db_type,
    )

    # 3. Collect all metrics needed
    all_metrics_needed: set[str] = set()
    for analyzer in analyzers:
        all_metrics_needed.update(analyzer.REQUIRED_METRICS)
        if hasattr(analyzer, "CORROBORATING_METRICS"):
            all_metrics_needed.update(analyzer.CORROBORATING_METRICS)

    # 4. Fetch live metrics
    metrics = await adapter.get_latest_metrics(
        cluster_id=cluster_composite_id,
        canonical_names=list(all_metrics_needed),
    )
    if not metrics:
        logger.warning(f"No metrics returned for {cluster_composite_id} — skipping")
        return
    logger.info(f"  Metrics: {list(metrics.keys())}")

    # 5. Load baselines
    baselines = await get_baselines_for_cluster(db, cluster_composite_id, WINDOW_ALL)
    logger.info(f"  Baselines: {len(baselines)} profiles")

    log_signals: dict[str, int] = {}
    all_statuses: list[HealthStatus] = []

    # 6. Run analyzers
    for analyzer in analyzers:
        available = set(metrics.keys())
        if not analyzer.can_run(available):
            missing = set(analyzer.REQUIRED_METRICS) - available
            logger.warning(f"  [{analyzer.ANALYZER_NAME}] Cannot run — missing: {missing}")
            continue

        # Per-instance analyzers get their data fetched separately
        per_instance: dict | None = None
        if isinstance(analyzer, InnodbBufferPoolPressureAnalyzer):
            try:
                per_instance = await adapter.get_latest_metrics_per_instance(
                    cluster_id=cluster_composite_id,
                    canonical_names=PER_INSTANCE_METRICS,
                )
                logger.info(f"  [{analyzer.ANALYZER_NAME}] Per-instance data: {list(per_instance.keys())}")
            except Exception as e:
                logger.warning(f"  [{analyzer.ANALYZER_NAME}] Per-instance fetch failed: {e} — falling back to cluster avg")

        analyze_kwargs = dict(
            metrics=metrics,
            baselines=baselines,
            log_signals=log_signals,
            metric_ts=run_at,
        )
        if per_instance is not None:
            analyze_kwargs["per_instance_metrics"] = per_instance

        raw = analyzer.analyze(**analyze_kwargs)

        # Analyzers may return a single VerdictResult or a list (per-instance)
        results = raw if isinstance(raw, list) else [raw]

        for result in results:
            instance_label = f" [{result.instance_id}]" if result.instance_id else ""
            prev_status = await _get_prev_status(db, cluster_uuid, analyzer.ANALYZER_NAME, result.instance_id)
            verdict = await _write_verdict(db, cluster_uuid, result, prev_status, run_at)

            status_changed = prev_status != result.status
            logger.info(
                f"  [{analyzer.ANALYZER_NAME}]{instance_label} "
                f"status={result.status.value}  confidence={result.confidence.value}  "
                f"prev={prev_status.value if prev_status else 'none'}  "
                f"changed={'YES' if status_changed else 'no'}"
            )

            if status_changed:
                prev_label = prev_status.value if prev_status else "none"
                trigger = f"status changed from {prev_label} to {result.status.value}"
                await generate_explanation(
                    db=db,
                    verdict_id=verdict.id,
                    result=result,
                    prev_status=prev_status,
                    cluster_display_name=cluster.display_name,
                    trigger_reason=trigger,
                )

            all_statuses.append(result.status)

    # 6. Update cluster status
    if all_statuses:
        worst = _worst_status(*all_statuses)
        await _update_cluster_status(db, cluster_uuid, worst)
        logger.info(f"  Status → {worst.value}")

    await db.commit()


async def run(cluster_ids: list[str]) -> None:
    run_at = datetime.now(timezone.utc)

    logger.info("Analyzer runner starting")
    logger.info(f"  Clusters:  {len(cluster_ids)}")
    logger.info(f"  ES analyzers:    {[a.ANALYZER_NAME for a in ES_ANALYZERS]}")
    logger.info(f"  MySQL analyzers: {[a.ANALYZER_NAME for a in MYSQL_ANALYZERS]}")
    logger.info(f"  Run at:    {run_at.isoformat()}")

    async with AsyncSessionLocal() as db:
        for cluster_id in cluster_ids:
            await run_cluster(db, cluster_id, run_at)

    logger.info("\nAll clusters done.")


if __name__ == "__main__":
    if "--all-alpha-mysql" in sys.argv:
        clusters = MYSQL_ALPHA_CLUSTERS
    elif "--all-alpha-both" in sys.argv:
        clusters = ALL_ALPHA_CLUSTERS + MYSQL_ALPHA_CLUSTERS
    elif "--all-alpha" in sys.argv or "--all-alpha-es" in sys.argv:
        clusters = ALL_ALPHA_CLUSTERS
    elif len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
        clusters = [sys.argv[1]]
    else:
        clusters = [DEFAULT_CLUSTER_ID]

    asyncio.run(run(clusters))
