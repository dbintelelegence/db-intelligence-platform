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

# ── Target cluster ────────────────────────────────────────────────────────────

CLUSTER_COMPOSITE_ID = "Alpha|us-east1|els_shrdone_alpha_va"

# ── Registered analyzers ──────────────────────────────────────────────────────
# Add new analyzers here as Steps 7-8 are built.

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

async def run() -> None:
    run_at = datetime.now(timezone.utc)

    logger.info("Analyzer runner starting")
    logger.info(f"  Cluster:   {CLUSTER_COMPOSITE_ID}")
    logger.info(f"  Analyzers: {[a.ANALYZER_NAME for a in ANALYZERS]}")
    logger.info(f"  Run at:    {run_at.isoformat()}")

    async with AsyncSessionLocal() as db:
        # 1. Resolve composite string key → UUID (needed for FK on verdicts)
        stmt = select(Cluster).where(Cluster.cluster_id == CLUSTER_COMPOSITE_ID)
        cluster = (await db.execute(stmt)).scalar_one_or_none()
        if cluster is None:
            logger.error(f"Cluster not found in DB: {CLUSTER_COMPOSITE_ID}")
            sys.exit(1)
        cluster_uuid = cluster.id
        logger.info(f"  Cluster UUID: {cluster_uuid}")

        # 2. Collect all metrics needed across all registered analyzers
        all_metrics_needed: set[str] = set()
        for analyzer in ANALYZERS:
            all_metrics_needed.update(analyzer.REQUIRED_METRICS)
            # Include corroborating metrics if the analyzer declares them
            if hasattr(analyzer, "CORROBORATING_METRICS"):
                all_metrics_needed.update(analyzer.CORROBORATING_METRICS)

        # 3. Fetch current metric values from Grafana Cloud
        adapter = GrafanaCloudAdapter(
            prometheus_url=settings.grafana_gcp_prod_url,
            instance_id=settings.grafana_gcp_prod_instance_id,
            api_key=settings.grafana_gcp_prod_api_key,
            db=db,
        )

        logger.info(f"Fetching {len(all_metrics_needed)} metrics from Grafana Cloud ...")
        metrics = await adapter.get_latest_metrics(
            cluster_id=CLUSTER_COMPOSITE_ID,
            canonical_names=list(all_metrics_needed),
        )
        logger.info(f"  Received: {list(metrics.keys())}")

        if not metrics:
            logger.error("No metrics returned — aborting run")
            sys.exit(1)

        # 4. Load baseline profiles for this cluster (all-window)
        baselines = await get_baselines_for_cluster(db, CLUSTER_COMPOSITE_ID, WINDOW_ALL)
        logger.info(f"  Baselines loaded: {len(baselines)} profiles")

        # No log signals in Phase 1 — pass empty dict
        log_signals: dict[str, int] = {}

        # 5. Run each analyzer
        all_statuses: list[HealthStatus] = []

        for analyzer in ANALYZERS:
            available = set(metrics.keys())
            if not analyzer.can_run(available):
                missing = set(analyzer.REQUIRED_METRICS) - available
                logger.warning(
                    f"[{analyzer.ANALYZER_NAME}] Cannot run — missing metrics: {missing}"
                )
                continue

            logger.info(f"[{analyzer.ANALYZER_NAME}] Running ...")
            result = analyzer.analyze(
                metrics=metrics,
                baselines=baselines,
                log_signals=log_signals,
                metric_ts=run_at,
            )

            # Fetch previous verdict status for change detection
            prev_status = await _get_prev_status(db, cluster_uuid, analyzer.ANALYZER_NAME)

            # Write verdict (append-only)
            verdict = await _write_verdict(db, cluster_uuid, result, prev_status, run_at)

            status_changed = prev_status != result.status
            logger.info(
                f"[{analyzer.ANALYZER_NAME}] "
                f"status={result.status.value}  "
                f"confidence={result.confidence.value}  "
                f"prev={prev_status.value if prev_status else 'none'}  "
                f"changed={'YES' if status_changed else 'no'}"
            )

            for ev in result.evidence:
                logger.info(f"  evidence: {ev.text}")

            if status_changed:
                prev_label = prev_status.value if prev_status else "none"
                trigger = f"status changed from {prev_label} to {result.status.value}"
                logger.info(f"  [STATUS CHANGE] {trigger} — generating LLM explanation")
                await generate_explanation(
                    db=db,
                    verdict_id=verdict.id,
                    result=result,
                    prev_status=prev_status,
                    cluster_display_name=cluster.display_name,
                    trigger_reason=trigger,
                )

            all_statuses.append(result.status)

        # 6. Update denormalised cluster status to worst across all analyzers
        if all_statuses:
            worst = _worst_status(*all_statuses)
            await _update_cluster_status(db, cluster_uuid, worst)
            logger.info(f"Cluster status updated → {worst.value}")

        await db.commit()
        logger.info("Run complete — verdicts committed")


if __name__ == "__main__":
    asyncio.run(run())
