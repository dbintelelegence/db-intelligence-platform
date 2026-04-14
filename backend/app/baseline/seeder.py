"""
Baseline Seeder — Step 4

Pulls historical metric data for one or more clusters and computes baseline
profiles for all 5 window types.

Usage:
    cd backend
    # Single cluster (default):
    python -m app.baseline.seeder

    # Specific cluster:
    python -m app.baseline.seeder Alpha|us-east1|els_shrdegt_alpha_va

    # All Alpha clusters:
    python -m app.baseline.seeder --all-alpha

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

# ── Target clusters ───────────────────────────────────────────────────────────

DEFAULT_CLUSTER_ID = "Alpha|us-east1|els_shrdone_alpha_va"

ALL_ALPHA_CLUSTERS = [
    "Alpha|us-east1|els_shrdegt_alpha_va",
    "Alpha|us-east1|els_shrdone_alpha_va",
    "Alpha|us-east1|els_shrdsix_alpha_va",
    "Alpha|us-east1|els_shrdsvn_alpha_va",
    "Alpha|us-east1|els_sixna_alpha_va",
]

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

async def seed_cluster(adapter: GrafanaCloudAdapter, db, cluster_id: str, now: datetime, start: datetime) -> tuple[int, int]:
    """Seed baselines for a single cluster. Returns (written, skipped)."""
    profiles_written = 0
    profiles_skipped = 0

    for metric in METRICS:
        logger.info(f"  [{cluster_id}] Fetching {metric} ...")

        series_list = await adapter.get_metrics(
            cluster_id=cluster_id,
            canonical_names=[metric],
            start=start,
            end=now,
            step_seconds=STEP_SECONDS,
        )

        if not series_list:
            logger.warning(f"  [{cluster_id}] No data for {metric} — skipping all windows")
            profiles_skipped += len(ALL_WINDOWS)
            await asyncio.sleep(INTER_METRIC_SLEEP_SECONDS)
            continue

        series = series_list[0]
        samples: list[tuple[datetime, float]] = [
            (pt.timestamp.replace(tzinfo=None), pt.value) for pt in series.points
        ]
        logger.info(f"  [{cluster_id}] {len(samples)} points")

        for window in ALL_WINDOWS:
            result = compute_baseline(
                canonical_metric_name=metric,
                window_type=window,
                samples=samples,
                lookback_days=LOOKBACK_DAYS,
            )

            if result is None:
                logger.warning(f"  [{cluster_id}] [{window}] insufficient samples — skipped")
                profiles_skipped += 1
                continue

            if not result.is_valid:
                logger.warning(
                    f"  [{cluster_id}] [{window}] {result.sample_count} samples < minimum — "
                    f"writing at LOW confidence"
                )

            await upsert_baseline(db, cluster_id, result)
            await db.commit()
            logger.info(
                f"  [{cluster_id}] [{window}] p50={result.p50:.3f} p95={result.p95:.3f} "
                f"std={result.std_dev:.3f}"
            )
            profiles_written += 1

        await asyncio.sleep(INTER_METRIC_SLEEP_SECONDS)

    return profiles_written, profiles_skipped


async def run(cluster_ids: list[str]) -> None:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=LOOKBACK_DAYS)

    logger.info(f"Baseline seeder starting")
    logger.info(f"  Clusters: {len(cluster_ids)}")
    logger.info(f"  Window:   {start.isoformat()} → {now.isoformat()} ({LOOKBACK_DAYS}d)")
    logger.info(f"  Step:     {STEP_SECONDS}s ({STEP_SECONDS // 60} min)")

    total_written = 0
    total_skipped = 0

    async with AsyncSessionLocal() as db:
        adapter = GrafanaCloudAdapter(
            prometheus_url=settings.grafana_gcp_prod_url,
            instance_id=settings.grafana_gcp_prod_instance_id,
            api_key=settings.grafana_gcp_prod_api_key,
            db=db,
        )

        conn = await adapter.test_connection()
        if not conn.success:
            logger.error(f"Connection failed: {conn.error}")
            sys.exit(1)
        logger.info("Connection verified OK")

        for cluster_id in cluster_ids:
            logger.info(f"\n── Seeding {cluster_id} ──")
            written, skipped = await seed_cluster(adapter, db, cluster_id, now, start)
            total_written += written
            total_skipped += skipped

    logger.info(
        f"\nDone. Profiles written: {total_written}  |  Skipped: {total_skipped}"
    )


if __name__ == "__main__":
    if "--all-alpha" in sys.argv:
        clusters = ALL_ALPHA_CLUSTERS
    elif len(sys.argv) > 1 and not sys.argv[1].startswith("--"):
        clusters = [sys.argv[1]]
    else:
        clusters = [DEFAULT_CLUSTER_ID]

    asyncio.run(run(clusters))
