"""
Baseline Seeder — Step 4

Pulls historical metric data for the prototype cluster and computes baseline
profiles for all 5 window types.

Usage:
    cd backend
    python -m app.baseline.seeder

Scope:
    Cluster: els_shrdone_alpha_va (Alpha) — prototype only
    Window:  2 days of history at 5-minute step (576 points per metric)
    Windows: all, weekday, weekend, business_hours, off_hours

Design:
    - Sequential per-metric API calls with a small sleep between them.
      This avoids rate limit spikes when fetching 7 metrics at once.
    - 576 points >> 100-sample minimum required by baseline engine.
    - Grafana Cloud retains 13 months; we re-query on demand (no local storage).
    - Warns if any window type has fewer than 100 samples (not an error — just logged).
"""

import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone

from app.adapters.grafana_cloud.adapter import GrafanaCloudAdapter
from app.baseline.engine import (
    WINDOW_ALL,
    WINDOW_BUSINESS,
    WINDOW_OFF_HOURS,
    WINDOW_WEEKDAY,
    WINDOW_WEEKEND,
    compute_baseline,
    upsert_baseline,
)
from app.core.config import get_settings
from app.db.session import AsyncSessionLocal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

settings = get_settings()

# ── Target cluster ────────────────────────────────────────────────────────────

CLUSTER_ID = "Alpha|us-east1|els_shrdone_alpha_va"

# ── Metrics to baseline ───────────────────────────────────────────────────────
# Canonical names only. Adapter resolves to raw PromQL.
# Order matters for sequential fetching — highest-value metrics first.

METRICS = [
    # JVM Heap Pressure analyzer
    "jvm.heap.used.percent",          # derived: used_bytes / max_bytes * 100
    "gc.old.collection.seconds",
    "gc.old.collection.count",
    # Shard Allocation analyzer
    "cluster.shards.unassigned",
    "cluster.health.status",
    # Thread Pool analyzer
    "thread_pool.write.rejected",
    "thread_pool.write.queue",
]

# Window types to compute — all 5 required by the engine
ALL_WINDOWS = [WINDOW_ALL, WINDOW_WEEKDAY, WINDOW_WEEKEND, WINDOW_BUSINESS, WINDOW_OFF_HOURS]

# Sleep between sequential metric fetches to avoid rate limit spikes
INTER_METRIC_SLEEP_SECONDS = 1.0

# History window
LOOKBACK_DAYS = 2
STEP_SECONDS = 300  # 5 minutes → 576 points per metric over 2 days


# ── Main ──────────────────────────────────────────────────────────────────────

async def run() -> None:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=LOOKBACK_DAYS)

    logger.info(f"Baseline seeder starting")
    logger.info(f"  Cluster:  {CLUSTER_ID}")
    logger.info(f"  Window:   {start.isoformat()} → {now.isoformat()} ({LOOKBACK_DAYS}d)")
    logger.info(f"  Step:     {STEP_SECONDS}s ({STEP_SECONDS // 60} min)")
    logger.info(f"  Metrics:  {len(METRICS)}")
    logger.info(f"  Profiles: {len(METRICS)} × {len(ALL_WINDOWS)} = {len(METRICS) * len(ALL_WINDOWS)} rows")

    async with AsyncSessionLocal() as db:
        adapter = GrafanaCloudAdapter(
            prometheus_url=settings.grafana_gcp_prod_url,
            instance_id=settings.grafana_gcp_prod_instance_id,
            api_key=settings.grafana_gcp_prod_api_key,
            db=db,
        )

        # Verify connection before pulling history
        conn = await adapter.test_connection()
        if not conn.success:
            logger.error(f"Connection failed: {conn.error}")
            sys.exit(1)
        logger.info("Connection verified OK")

        profiles_written = 0
        profiles_skipped = 0

        for metric in METRICS:
            logger.info(f"Fetching {metric} ...")

            series_list = await adapter.get_metrics(
                cluster_id=CLUSTER_ID,
                canonical_names=[metric],
                start=start,
                end=now,
                step_seconds=STEP_SECONDS,
            )

            if not series_list:
                logger.warning(f"  No data returned for {metric} — skipping all windows")
                profiles_skipped += len(ALL_WINDOWS)
                await asyncio.sleep(INTER_METRIC_SLEEP_SECONDS)
                continue

            series = series_list[0]
            # engine.py uses datetime.utcnow() (naive) for cutoff comparison,
            # so we strip timezone info here to avoid offset-naive vs aware error.
            samples: list[tuple[datetime, float]] = [
                (pt.timestamp.replace(tzinfo=None), pt.value) for pt in series.points
            ]
            logger.info(f"  {len(samples)} points fetched")

            for window in ALL_WINDOWS:
                result = compute_baseline(
                    canonical_metric_name=metric,
                    window_type=window,
                    samples=samples,
                    lookback_days=LOOKBACK_DAYS,
                )

                if result is None:
                    logger.warning(
                        f"  [{window}] insufficient samples — baseline not written"
                    )
                    profiles_skipped += 1
                    continue

                if not result.is_valid:
                    logger.warning(
                        f"  [{window}] {result.sample_count} samples < "
                        f"{settings.baseline_min_samples} minimum — writing anyway "
                        f"(confidence will be capped at LOW)"
                    )

                await upsert_baseline(db, CLUSTER_ID, result)
                await db.commit()

                logger.info(
                    f"  [{window}] {result.sample_count} samples → "
                    f"p50={result.p50:.3f} p95={result.p95:.3f} "
                    f"mean={result.mean:.3f} std={result.std_dev:.3f}"
                )
                profiles_written += 1

            await asyncio.sleep(INTER_METRIC_SLEEP_SECONDS)

        logger.info(
            f"\nDone. "
            f"Profiles written: {profiles_written}  |  "
            f"Skipped: {profiles_skipped}"
        )


if __name__ == "__main__":
    asyncio.run(run())
