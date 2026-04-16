"""
Simulate an Elasticsearch fielddata circuit breaker incident.

Pushes a realistic progression for els_sim_incidents:
  Stage 0 — Baseline (healthy, 6 pushes at 60s intervals)
  Stage 1 — Eviction pressure building (degraded, 4 pushes)
  Stage 2 — Breaker starts tripping (critical, 4 pushes)
  Stage 3 — Full breaker storm (critical, 4 pushes)
  Stage 4 — Recovery after cache clear (healthy, 4 pushes)

This creates ~22 verdict rows so the trend chart has a proper time series.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python scripts/simulate_circuit_breaker.py \
        --token dbi_KGEw_WKxsIyaXj7XtkkTj4zCaWz7akof

The script also seeds ES sim baselines if they don't exist yet.
"""

import argparse
import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone

import httpx

from app.baseline.engine import (
    WINDOW_ALL, WINDOW_BUSINESS, WINDOW_OFF_HOURS, WINDOW_WEEKDAY, WINDOW_WEEKEND,
    compute_baseline, upsert_baseline,
)
from app.db.session import AsyncSessionLocal

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

BASE_URL    = "http://localhost:8000"
CLUSTER_ID  = "Sim|us-east1|els_sim_incidents"
GB          = 1024 ** 3
HEAP_MAX    = 8 * GB

ALL_WINDOWS = [WINDOW_ALL, WINDOW_WEEKDAY, WINDOW_WEEKEND, WINDOW_BUSINESS, WINDOW_OFF_HOURS]

# ── Baseline specs ────────────────────────────────────────────────────────────
# std_dev=0 for counter metrics that are always 0 in healthy state — this
# means any non-zero value is immediately flagged as critical by the analyzer.

ES_BASELINE_SPECS = [
    # JVM heap (healthy: 55-62%)
    ("jvm.heap.used.percent",          58.0, 2.5,  576),
    ("gc.old.collection.seconds",       0.25, 0.08, 576),
    ("gc.old.collection.count",         2.0,  0.5,  576),

    # Fielddata / circuit breaker (healthy: always 0)
    ("fielddata.evictions",             0.0,  0.0,  576),  # std_dev=0 → any value = critical
    ("fielddata.memory.bytes",         50e6,  5e6,  576),  # ~50 MB normal
    ("circuit_breaker.tripped",         0.0,  0.0,  576),  # std_dev=0 → any trip = critical

    # Shard allocation (healthy)
    ("shard.unassigned.count",          0.0,  0.0,  576),
    ("cluster.status",                  1.0,  0.0,  576),
    ("shard.active.count",            240.0,  5.0,  576),
    ("shard.active.primary.count",    120.0,  2.0,  576),
    ("shard.initializing.count",        0.0,  0.0,  576),
    ("shard.relocating.count",          0.0,  0.0,  576),

    # Thread pool (healthy)
    ("thread_pool.write.rejected",      0.0,  0.0,  576),
    ("thread_pool.write.queue",         0.0,  0.5,  576),
    ("thread_pool.write.active",        3.0,  0.5,  576),

    # Disk (healthy: 40% used)
    ("fs.disk.used.percent",           40.0,  1.0,  576),
    ("fs.disk.available.bytes",       300e9,  2e9,  576),
    ("fs.disk.total.bytes",           500e9,  0.0,  576),
]


def _jitter(v: float, pct: float = 0.02) -> float:
    return v * (1 + random.uniform(-pct, pct))


def _base_metrics() -> dict:
    """Healthy ES cluster raw metric names."""
    return {
        "elasticsearch_jvm_memory_used_bytes":               int(HEAP_MAX * 0.58),
        "elasticsearch_jvm_memory_max_bytes":                HEAP_MAX,
        "elasticsearch_jvm_gc_collection_seconds_sum":       0.25,
        "elasticsearch_jvm_gc_collection_seconds_count":     2.0,
        "elasticsearch_cluster_health_status":               1.0,
        "elasticsearch_cluster_health_active_shards":        240.0,
        "elasticsearch_cluster_health_active_primary_shards":120.0,
        "elasticsearch_cluster_health_unassigned_shards":    0.0,
        "elasticsearch_cluster_health_initializing_shards":  0.0,
        "elasticsearch_cluster_health_relocating_shards":    0.0,
        "elasticsearch_thread_pool_rejected_count":          0.0,
        "elasticsearch_thread_pool_queue_count":             0.0,
        "elasticsearch_thread_pool_active_count":            3.0,
        # These are increase([5m]) values from CUSTOM_QUERIES — send 0 for healthy
        "elasticsearch_indices_fielddata_evictions":         0.0,
        "elasticsearch_indices_fielddata_memory_size_bytes": 50 * 1024 * 1024,
        "elasticsearch_breakers_tripped":                    0.0,
        "elasticsearch_indices_search_query_total":          4500.0,
        "elasticsearch_indices_search_query_time_seconds":   180.0,
        "elasticsearch_indices_indexing_index_total":        12000.0,
        "node_filesystem_size_bytes":                        500 * GB,
        "node_filesystem_avail_bytes":                       300 * GB,
        "node_memory_MemTotal_bytes":                        32 * GB,
        "node_memory_MemAvailable_bytes":                    18 * GB,
    }


# ── Stage builders ────────────────────────────────────────────────────────────

def stage_healthy() -> dict:
    m = _base_metrics()
    m["elasticsearch_indices_fielddata_evictions"]         = 0.0
    m["elasticsearch_indices_fielddata_memory_size_bytes"] = int(_jitter(50 * 1024 * 1024))
    m["elasticsearch_breakers_tripped"]                    = 0.0
    return m


def stage_eviction_pressure(step: int) -> dict:
    """Fielddata evictions climbing, no trips yet. step 0-3."""
    m = _base_metrics()
    evictions = _jitter(8.0 + step * 4)       # 8 → 20 evictions/5m
    fd_mb = 120 + step * 40                     # 120 → 240 MB fielddata
    heap_pct = 0.62 + step * 0.02              # heap creeping up: 62 → 68%
    m["elasticsearch_indices_fielddata_evictions"]         = evictions
    m["elasticsearch_indices_fielddata_memory_size_bytes"] = int(fd_mb * 1024 * 1024)
    m["elasticsearch_breakers_tripped"]                    = 0.0
    m["elasticsearch_jvm_memory_used_bytes"]               = int(HEAP_MAX * heap_pct)
    m["elasticsearch_jvm_gc_collection_seconds_sum"]       = _jitter(0.45)
    return m


def stage_breaker_starting(step: int) -> dict:
    """First breaker trips. step 0-3."""
    m = _base_metrics()
    evictions = _jitter(35.0 + step * 5)       # heavy evictions
    fd_mb = 320 + step * 30                     # 320 → 410 MB fielddata
    trips = _jitter(2.0 + step * 3)             # 2 → 11 trips/5m
    heap_pct = 0.72 + step * 0.02              # 72 → 78% heap
    m["elasticsearch_indices_fielddata_evictions"]         = evictions
    m["elasticsearch_indices_fielddata_memory_size_bytes"] = int(fd_mb * 1024 * 1024)
    m["elasticsearch_breakers_tripped"]                    = trips
    m["elasticsearch_jvm_memory_used_bytes"]               = int(HEAP_MAX * heap_pct)
    m["elasticsearch_jvm_gc_collection_seconds_sum"]       = _jitter(0.9)
    m["elasticsearch_jvm_gc_collection_seconds_count"]     = _jitter(7.0)
    return m


def stage_breaker_storm(step: int) -> dict:
    """Full breaker storm — all aggregations failing. step 0-3."""
    m = _base_metrics()
    evictions = _jitter(60.0 + step * 8)       # severe evictions
    fd_mb = 450 + step * 20                     # 450 → 510 MB fielddata
    trips = _jitter(15.0 + step * 5)            # 15 → 30 trips/5m
    heap_pct = 0.82 + step * 0.01              # 82 → 85%
    m["elasticsearch_indices_fielddata_evictions"]         = evictions
    m["elasticsearch_indices_fielddata_memory_size_bytes"] = int(fd_mb * 1024 * 1024)
    m["elasticsearch_breakers_tripped"]                    = trips
    m["elasticsearch_jvm_memory_used_bytes"]               = int(HEAP_MAX * heap_pct)
    m["elasticsearch_jvm_gc_collection_seconds_sum"]       = _jitter(1.8)
    m["elasticsearch_jvm_gc_collection_seconds_count"]     = _jitter(14.0)
    return m


def stage_recovery(step: int) -> dict:
    """After cache clear — fielddata dropping, trips stopping. step 0-3."""
    m = _base_metrics()
    evictions = max(0.0, _jitter(10.0 - step * 3))   # evictions dropping
    fd_mb = max(50, 200 - step * 50)                   # fielddata draining
    trips = max(0.0, _jitter(2.0 - step * 1.5))       # trips dropping to 0
    heap_pct = max(0.58, 0.72 - step * 0.04)          # heap recovering
    m["elasticsearch_indices_fielddata_evictions"]         = evictions
    m["elasticsearch_indices_fielddata_memory_size_bytes"] = int(fd_mb * 1024 * 1024)
    m["elasticsearch_breakers_tripped"]                    = trips
    m["elasticsearch_jvm_memory_used_bytes"]               = int(HEAP_MAX * heap_pct)
    m["elasticsearch_jvm_gc_collection_seconds_sum"]       = _jitter(0.3)
    return m


# ── Seeder ────────────────────────────────────────────────────────────────────

async def seed_es_baselines_if_needed() -> None:
    async with AsyncSessionLocal() as db:
        from app.baseline.engine import get_baseline
        # Check if already seeded
        existing = await get_baseline(db, CLUSTER_ID, "fielddata.evictions")
        if existing is not None:
            logger.info("ES sim baselines already present — skipping seed")
            return

    logger.info(f"Seeding ES sim baselines for {CLUSTER_ID} ...")
    start = datetime.now(timezone.utc) - timedelta(days=2)

    async with AsyncSessionLocal() as db:
        total = 0
        for canonical_name, mean, std_dev, n in ES_BASELINE_SPECS:
            samples = []
            ts = start
            for _ in range(n):
                value = max(0.0, random.gauss(mean, std_dev)) if std_dev > 0 else mean
                samples.append((ts.replace(tzinfo=None), value))
                ts += timedelta(seconds=300)

            for window in ALL_WINDOWS:
                result = compute_baseline(
                    canonical_metric_name=canonical_name,
                    window_type=window,
                    samples=samples,
                    lookback_days=2,
                )
                if result is None:
                    continue
                await upsert_baseline(db, CLUSTER_ID, result)
                total += 1
            await db.commit()
        logger.info(f"  {total} baseline profiles written")


# ── Push helper ───────────────────────────────────────────────────────────────

async def push(client: httpx.AsyncClient, token: str, metrics: dict, label: str) -> None:
    payload = {
        "cluster_id": CLUSTER_ID,
        "db_type": "elasticsearch",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "instances": {},
    }
    resp = await client.post(
        f"{BASE_URL}/ingest/metrics",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
        timeout=10.0,
    )
    resp.raise_for_status()
    logger.info(f"  pushed: {label}")


# ── Main ──────────────────────────────────────────────────────────────────────

STAGES = [
    ("Healthy baseline",      stage_healthy,           6, 8),
    ("Eviction pressure",     stage_eviction_pressure, 4, 8),
    ("Breaker starting",      stage_breaker_starting,  4, 8),
    ("Breaker storm",         stage_breaker_storm,     4, 8),
    ("Recovery",              stage_recovery,          4, 8),
]


async def run(token: str, delay: float) -> None:
    await seed_es_baselines_if_needed()

    total_pushes = sum(count for _, _, count, _ in STAGES)
    logger.info(f"\nSimulating fielddata circuit breaker incident on {CLUSTER_ID}")
    logger.info(f"Total pushes: {total_pushes} across {len(STAGES)} stages")
    logger.info(f"Inter-push delay: {delay}s\n")

    async with httpx.AsyncClient() as client:
        for stage_name, builder_fn, count, _ in STAGES:
            logger.info(f"[{stage_name}]")
            for step in range(count):
                # builder_fn may or may not take a step arg
                try:
                    metrics = builder_fn(step)
                except TypeError:
                    metrics = builder_fn()
                label = f"{stage_name} step {step+1}/{count}"
                await push(client, token, metrics, label)
                if step < count - 1:
                    await asyncio.sleep(delay)
            await asyncio.sleep(delay)

    logger.info("\nDone. Circuit breaker incident data written to DB.")
    logger.info(f"Check the dashboard for {CLUSTER_ID} to see the trend chart.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate ES fielddata circuit breaker incident")
    parser.add_argument("--token", required=True, help="Bearer token for /ingest/metrics")
    parser.add_argument("--delay", type=float, default=3.0,
                        help="Seconds between pushes (default 3 — fast sim)")
    parser.add_argument("--url", default="http://localhost:8000")
    args = parser.parse_args()

    global BASE_URL
    BASE_URL = args.url

    asyncio.run(run(args.token, args.delay))


if __name__ == "__main__":
    main()
