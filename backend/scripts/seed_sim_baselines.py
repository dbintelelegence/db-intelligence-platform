"""
Seed synthetic baselines for mysql_connpool_sim.

The sim cluster has no Grafana Cloud history, so the pull seeder cannot
build baselines for it. This script generates realistic normal-scenario
samples and writes them directly to the baseline_profiles table.

Normal scenario values (from simulate_connpool.py):
  mysql.connection.pct   ≈ 52%  (104/200 connections), std ≈ 3%
  mysql.threads.running  ≈ 11   threads, std ≈ 2
  mysql.slow.query.rate  ≈ 0.05 /s, std ≈ 0.01
  mysql.query.rate       ≈ 1020 /s, std ≈ 50

Run from backend/ directory:
    python scripts/seed_sim_baselines.py
"""

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone

from app.baseline.engine import (
    WINDOW_ALL,
    WINDOW_BUSINESS,
    WINDOW_OFF_HOURS,
    WINDOW_WEEKDAY,
    WINDOW_WEEKEND,
    compute_baseline,
    upsert_baseline,
)
from app.db.session import AsyncSessionLocal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

CLUSTER_ID = "Sim|us-east1|mysql_connpool_sim"

# Baseline specs: (canonical_name, mean, std_dev, n_samples)
# Derived from normal scenario: 104/200 conns, 11 threads, 0.05 slow/s, 1020 q/s
BASELINE_SPECS = [
    # Connection pool
    ("mysql.connection.pct",    52.0,  3.0,   576),  # 104/200 = 52%, varies ±3%
    ("mysql.connections.current", 104.0, 6.0, 576),  # 104 connections
    ("mysql.threads.running",   11.0,  2.0,   576),  # 11 threads
    # Query signals
    ("mysql.slow.query.rate",   0.05,  0.01,  576),  # almost no slow queries
    ("mysql.query.rate",        1020.0, 50.0, 576),  # ~1000 q/s
    # Buffer pool (healthy)
    ("mysql.buffer.pool.pressure.pct", 25.0, 2.0, 576),  # 4GB/16GB = 25%
    ("mysql.buffer.pool.bytes", 4 * 1024**3, 0.0, 576),
    ("mysql.memory.total.bytes", 16 * 1024**3, 0.0, 576),
    ("mysql.memory.available.bytes", 8 * 1024**3, 0.4 * 1024**3, 576),
    # Disk (healthy)
    ("mysql.disk.total.bytes",    200 * 1024**3, 0.0, 576),
    ("mysql.disk.available.bytes", 130 * 1024**3, 1 * 1024**3, 576),
    # Replication (healthy)
    ("mysql.replication.lag.seconds", 1.1, 0.1, 576),
]

ALL_WINDOWS = [WINDOW_ALL, WINDOW_WEEKDAY, WINDOW_WEEKEND, WINDOW_BUSINESS, WINDOW_OFF_HOURS]


def _generate_samples(
    mean: float,
    std_dev: float,
    n: int,
    start: datetime,
    step_seconds: int = 300,
) -> list[tuple[datetime, float]]:
    """Generate n normally-distributed samples starting at 'start'."""
    samples = []
    ts = start
    for _ in range(n):
        value = max(0.0, random.gauss(mean, std_dev)) if std_dev > 0 else mean
        samples.append((ts.replace(tzinfo=None), value))
        ts += timedelta(seconds=step_seconds)
    return samples


async def seed() -> None:
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=2)

    logger.info(f"Seeding synthetic baselines for: {CLUSTER_ID}")
    logger.info(f"  Window: {start.isoformat()} → {now.isoformat()} (2d)")
    logger.info(f"  Metrics: {len(BASELINE_SPECS)}")

    async with AsyncSessionLocal() as db:
        total_written = 0

        for canonical_name, mean, std_dev, n in BASELINE_SPECS:
            samples = _generate_samples(mean, std_dev, n, start)

            for window in ALL_WINDOWS:
                result = compute_baseline(
                    canonical_metric_name=canonical_name,
                    window_type=window,
                    samples=samples,
                    lookback_days=2,
                )
                if result is None:
                    logger.warning(f"  [{canonical_name}] [{window}] insufficient samples — skipped")
                    continue

                await upsert_baseline(db, CLUSTER_ID, result)
                total_written += 1

            await db.commit()
            logger.info(
                f"  {canonical_name}: p50={mean:.2f} std_dev={std_dev:.2f} "
                f"→ {len(ALL_WINDOWS)} windows written"
            )

    logger.info(f"\nDone. {total_written} baseline profiles written for {CLUSTER_ID}")
    logger.info("Now push a scenario:")
    logger.info("  python scripts/simulate_connpool.py --token <TOKEN> --scenario leak")
    logger.info("  python scripts/simulate_connpool.py --token <TOKEN> --scenario pileup")
    logger.info("  python scripts/simulate_connpool.py --token <TOKEN> --scenario surge")


if __name__ == "__main__":
    asyncio.run(seed())
