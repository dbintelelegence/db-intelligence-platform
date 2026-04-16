"""
Seed synthetic baselines for Sim|us-east1|mysql_sim_incidents.

The sim cluster has no Grafana Cloud history, so the pull seeder cannot build
baselines. This script generates realistic normal-scenario samples covering all
four MySQL analyzers: connection_pool_saturation, replication_lag,
innodb_buffer_pool_pressure, and disk_space.

Run from backend/ directory:
    PYTHONPATH=. .venv/bin/python scripts/seed_mysql_sim_baselines.py
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

CLUSTER_ID = "Sim|us-east1|mysql_sim_incidents"

GB = 1024 ** 3

# (canonical_name, mean, std_dev, n_samples)
# All values reflect a healthy MySQL cluster — what "normal" looks like.
BASELINE_SPECS = [
    # ── connection_pool_saturation ────────────────────────────────────────────
    ("mysql.connection.pct",       24.0,   3.0,   576),  # 120/500 = 24%
    ("mysql.connections.current",  120.0,  15.0,  576),  # 120 active connections
    ("mysql.threads.running",      10.0,   2.0,   576),  # 10 active threads
    ("mysql.slow.query.rate",      0.05,   0.01,  576),  # minimal slow queries
    ("mysql.query.rate",           950.0,  80.0,  576),  # ~950 q/s

    # ── replication_lag ───────────────────────────────────────────────────────
    ("mysql.replication.lag.seconds", 1.0, 0.2,  576),   # 1s lag, tight std
    ("mysql.replication.io.running",  1.0, 0.0,  576),   # always running (binary)
    ("mysql.replication.sql.running", 1.0, 0.0,  576),   # always running (binary)

    # ── innodb_buffer_pool_pressure ───────────────────────────────────────────
    # Pressure = innodb_buffer_pool_size / node_memory_MemTotal_bytes * 100
    # Healthy: 4GB pool on 16GB machine = 25%
    ("mysql.buffer.pool.pressure.pct", 25.0, 2.0, 576),
    ("mysql.buffer.pool.bytes",        4 * GB, 0.0, 576),
    ("mysql.memory.total.bytes",       16 * GB, 0.0, 576),
    ("mysql.memory.available.bytes",   6 * GB, 0.5 * GB, 576),
    ("mysql.tmp.disk.tables",          5.0, 1.0, 576),   # low temp disk usage

    # ── disk_space ────────────────────────────────────────────────────────────
    ("mysql.disk.total.bytes",     200 * GB, 0.0,       576),
    ("mysql.disk.available.bytes", 120 * GB, 2 * GB,    576),  # 40% used
    ("mysql.slow.queries.total",   5.0,      1.0,       576),
]

ALL_WINDOWS = [WINDOW_ALL, WINDOW_WEEKDAY, WINDOW_WEEKEND, WINDOW_BUSINESS, WINDOW_OFF_HOURS]


def _generate_samples(
    mean: float,
    std_dev: float,
    n: int,
    start: datetime,
    step_seconds: int = 300,
) -> list[tuple[datetime, float]]:
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
                f"  {canonical_name}: mean={mean:.2f} std={std_dev:.2f} "
                f"→ {len(ALL_WINDOWS)} windows written"
            )

    logger.info(f"\nDone. {total_written} baseline profiles written for {CLUSTER_ID}")


if __name__ == "__main__":
    asyncio.run(seed())
