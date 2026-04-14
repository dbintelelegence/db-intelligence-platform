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
from app.baseline.engine import WINDOW_ALL, get_baselines_for_cluster
from app.core.config import get_settings
from app.db.session import AsyncSessionLocal
from app.models.models import (
    Cluster, DataFreshness, HealthStatus, Verdict, VerdictEvidence,
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

# ── Registered analyzers ──────────────────────────────────────────────────────

ANALYZERS = [
    JvmHeapPressureAnalyzer(),
    ShardAllocationAnalyzer(),
    ThreadPoolSaturationAnalyzer(),
]


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_prev_status(
    db,
    cluster_uuid,
    analyzer_name: str,
) -> HealthStatus | None:
    """Fetch the most recent verdict status for this cluster + analyzer."""
    stmt = (
        select(Verdict.status)
        .where(
            and_(
                Verdict.cluster_id == cluster_uuid,
                Verdict.analyzer_name == analyzer_name,
            )
        )
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

    # Compute lag: time between when ES produced the metric and when we ran
    lag_seconds = None
    freshness = DataFreshness.fresh
    if result.metric_ts:
        lag = (run_at - result.metric_ts).total_seconds()
        lag_seconds = int(lag)
        if lag > 300:
            freshness = DataFreshness.stale

    verdict = Verdict(
        cluster_id=cluster_uuid,
        analyzer_name=result.analyzer_name,
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

async def run_cluster(db, adapter: GrafanaCloudAdapter, cluster_composite_id: str, run_at: datetime) -> None:
    """Run a full analysis cycle for a single cluster."""
    logger.info(f"\n── Analyzing {cluster_composite_id} ──")

    # 1. Resolve composite string key → UUID
    stmt = select(Cluster).where(Cluster.cluster_id == cluster_composite_id)
    cluster = (await db.execute(stmt)).scalar_one_or_none()
    if cluster is None:
        logger.error(f"Cluster not found in DB: {cluster_composite_id}")
        return
    cluster_uuid = cluster.id

    # 2. Collect all metrics needed
    all_metrics_needed: set[str] = set()
    for analyzer in ANALYZERS:
        all_metrics_needed.update(analyzer.REQUIRED_METRICS)
        if hasattr(analyzer, "CORROBORATING_METRICS"):
            all_metrics_needed.update(analyzer.CORROBORATING_METRICS)

    # 3. Fetch live metrics
    metrics = await adapter.get_latest_metrics(
        cluster_id=cluster_composite_id,
        canonical_names=list(all_metrics_needed),
    )
    if not metrics:
        logger.warning(f"No metrics returned for {cluster_composite_id} — skipping")
        return
    logger.info(f"  Metrics: {list(metrics.keys())}")

    # 4. Load baselines
    baselines = await get_baselines_for_cluster(db, cluster_composite_id, WINDOW_ALL)
    logger.info(f"  Baselines: {len(baselines)} profiles")

    log_signals: dict[str, int] = {}
    all_statuses: list[HealthStatus] = []

    # 5. Run analyzers
    for analyzer in ANALYZERS:
        available = set(metrics.keys())
        if not analyzer.can_run(available):
            missing = set(analyzer.REQUIRED_METRICS) - available
            logger.warning(f"  [{analyzer.ANALYZER_NAME}] Cannot run — missing: {missing}")
            continue

        result = analyzer.analyze(
            metrics=metrics,
            baselines=baselines,
            log_signals=log_signals,
            metric_ts=run_at,
        )

        prev_status = await _get_prev_status(db, cluster_uuid, analyzer.ANALYZER_NAME)
        verdict = await _write_verdict(db, cluster_uuid, result, prev_status, run_at)

        status_changed = prev_status != result.status
        logger.info(
            f"  [{analyzer.ANALYZER_NAME}] "
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
    logger.info(f"  Analyzers: {[a.ANALYZER_NAME for a in ANALYZERS]}")
    logger.info(f"  Run at:    {run_at.isoformat()}")

    async with AsyncSessionLocal() as db:
        adapter = GrafanaCloudAdapter(
            prometheus_url=settings.grafana_gcp_prod_url,
            instance_id=settings.grafana_gcp_prod_instance_id,
            api_key=settings.grafana_gcp_prod_api_key,
            db=db,
        )

        for cluster_id in cluster_ids:
            await run_cluster(db, adapter, cluster_id, run_at)

    logger.info("\nAll clusters done.")


if __name__ == "__main__":
    if "--all-alpha" in sys.argv:
        clusters = ALL_ALPHA_CLUSTERS
    elif len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
        clusters = [sys.argv[1]]
    else:
        clusters = [DEFAULT_CLUSTER_ID]

    asyncio.run(run(clusters))
