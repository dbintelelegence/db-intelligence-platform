"""
Push ingest simulation script.

Creates realistic metric data and pushes it via POST /ingest/metrics:
  - 1 Elasticsearch cluster with 4 nodes
  - 1 MySQL cluster with 2 nodes

Scenario:
  ES cluster: mostly healthy, node-3 has elevated JVM heap (degraded)
  MySQL cluster: healthy overall, node-2 has high buffer pool pressure (degraded)

Usage:
    cd backend
    # First issue a token (or reuse existing):
    python -m scripts.issue_ingest_token --tenant-name "prototype" --db-type elasticsearch --label "sim-es"
    python -m scripts.issue_ingest_token --tenant-name "prototype" --db-type mysql --label "sim-mysql"

    # Then run the sim (replace tokens):
    python -m scripts.simulate_push --es-token dbi_... --mysql-token dbi_...

    # Or run continuously:
    python -m scripts.simulate_push --es-token dbi_... --mysql-token dbi_... --loop --interval 30
"""

import argparse
import asyncio
import logging
import math
import random
import sys
import time
from datetime import datetime, timezone

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

BASE_URL = "http://localhost:8000"

# ── Cluster definitions ───────────────────────────────────────────────────────

ES_CLUSTER_ID = "Sim|us-east1|els_sim_primary"
ES_NODES = ["node-1", "node-2", "node-3", "node-4"]

MYSQL_CLUSTER_ID = "Sim|us-east1|mysql_sim_primary"
MYSQL_NODES = ["db-primary", "db-replica"]


# ── Metric generators ─────────────────────────────────────────────────────────

def _jitter(base: float, pct: float = 0.03) -> float:
    """Add ±pct random noise to a value."""
    return base * (1 + random.uniform(-pct, pct))


def build_es_payload(ts: datetime, scenario: str = "normal") -> dict:
    """
    Build a push payload for the ES cluster.

    Scenarios:
      normal    — all nodes healthy (heap 55-65%, GC low)
      degraded  — node-3 heap at 78%, elevated GC
      critical  — node-3 heap at 88%, very high GC, thread pool rejections
    """
    # Cluster-level aggregates (averages across nodes)
    if scenario == "critical":
        cluster_heap_pct   = 80.0
        gc_seconds         = 1.4
        gc_count           = 10.0
        tp_rejected        = 15.0
        unassigned_shards  = 3.0
    elif scenario == "degraded":
        cluster_heap_pct   = 72.0
        gc_seconds         = 0.65
        gc_count           = 4.5
        tp_rejected        = 2.0
        unassigned_shards  = 0.0
    else:
        cluster_heap_pct   = 60.0
        gc_seconds         = 0.28
        gc_count           = 2.0
        tp_rejected        = 0.0
        unassigned_shards  = 0.0

    heap_used_bytes = int(8 * 1024**3 * cluster_heap_pct / 100)
    heap_max_bytes  = 8 * 1024**3  # 8 GB per node

    cluster_metrics = {
        "elasticsearch_jvm_memory_used_bytes":           _jitter(heap_used_bytes),
        "elasticsearch_jvm_memory_max_bytes":            heap_max_bytes,
        "elasticsearch_jvm_gc_collection_seconds_sum":   _jitter(gc_seconds),
        "elasticsearch_jvm_gc_collection_seconds_count": _jitter(gc_count),
        "elasticsearch_cluster_health_unassigned_shards": unassigned_shards,
        "elasticsearch_cluster_health_status":            1.0,
        "elasticsearch_cluster_health_active_shards":     240.0,
        "elasticsearch_cluster_health_active_primary_shards": 120.0,
        "elasticsearch_thread_pool_rejected_count":       tp_rejected,
        "elasticsearch_thread_pool_queue_count":          _jitter(tp_rejected * 3),
        "elasticsearch_thread_pool_active_count":         _jitter(8),
        "elasticsearch_indices_fielddata_evictions":      0.0 if scenario == "normal" else _jitter(12),
        "elasticsearch_indices_search_query_total":       _jitter(4500),
        "elasticsearch_indices_search_query_time_seconds": _jitter(180),
        "elasticsearch_indices_indexing_index_total":     _jitter(12000),
        "node_filesystem_size_bytes":                     500 * 1024**3,
        "node_filesystem_avail_bytes":                    _jitter(280 * 1024**3),
        "node_memory_MemTotal_bytes":                     32 * 1024**3,
        "node_memory_MemAvailable_bytes":                 _jitter(18 * 1024**3),
    }

    # Per-node breakdown — node-3 is the hot one in degraded/critical
    node_heaps = {
        "node-1": 58.0,
        "node-2": 61.0,
        "node-3": 88.0 if scenario == "critical" else (78.0 if scenario == "degraded" else 62.0),
        "node-4": 59.0,
    }
    node_gc_seconds = {
        "node-1": 0.25,
        "node-2": 0.30,
        "node-3": 1.6 if scenario == "critical" else (0.7 if scenario == "degraded" else 0.28),
        "node-4": 0.27,
    }

    instances = {}
    for node in ES_NODES:
        heap_pct = node_heaps[node]
        used = int(heap_max_bytes * heap_pct / 100)
        instances[node] = {
            "elasticsearch_jvm_memory_used_bytes":           _jitter(used),
            "elasticsearch_jvm_memory_max_bytes":            heap_max_bytes,
            "elasticsearch_jvm_gc_collection_seconds_sum":   _jitter(node_gc_seconds[node]),
            "elasticsearch_jvm_gc_collection_seconds_count": _jitter(2.2),
            "elasticsearch_thread_pool_rejected_count":
                _jitter(12) if (node == "node-3" and scenario == "critical") else 0.0,
        }

    return {
        "cluster_id": ES_CLUSTER_ID,
        "db_type": "elasticsearch",
        "timestamp": ts.isoformat(),
        "metrics": cluster_metrics,
        "instances": instances,
    }


def build_mysql_payload(ts: datetime, scenario: str = "normal") -> dict:
    """
    Build a push payload for the MySQL cluster.

    Scenarios:
      normal    — both nodes healthy
      degraded  — db-replica buffer pool pressure at 80%
      critical  — db-replica buffer pool pressure at 90%, replication lag 45s
    """
    # Cluster-level metrics
    connections_current = _jitter(180 if scenario == "critical" else 120)
    connections_max     = 500.0
    replication_lag     = 45.0 if scenario == "critical" else (8.0 if scenario == "degraded" else 1.5)

    cluster_metrics = {
        "mysql_global_status_threads_connected":            connections_current,
        "mysql_global_variables_max_connections":           connections_max,
        "mysql_global_status_threads_running":              _jitter(12),
        "mysql_slave_status_seconds_behind_master":         _jitter(replication_lag),
        "mysql_slave_status_slave_io_running":              1.0,
        "mysql_slave_status_slave_sql_running":             1.0,
        "mysql_global_variables_innodb_buffer_pool_size":   4 * 1024**3,
        "node_memory_MemTotal_bytes":                       16 * 1024**3,
        "node_memory_MemAvailable_bytes":                   _jitter(6 * 1024**3),
        "mysql_global_status_slow_queries":                 _jitter(8),
        "mysql_global_status_queries":                      _jitter(95000),
        "node_filesystem_size_bytes":                       200 * 1024**3,
        "node_filesystem_avail_bytes":                      _jitter(120 * 1024**3),
    }

    # Per-instance buffer pool data
    # db-replica is under pressure in degraded/critical
    buffer_pool_size = 4 * 1024**3   # 4 GB configured
    total_ram        = 16 * 1024**3  # 16 GB total

    replica_pool_pct = 0.90 if scenario == "critical" else (0.82 if scenario == "degraded" else 0.55)
    primary_pool_pct = 0.52

    instances = {
        "db-primary": {
            "mysql_global_variables_innodb_buffer_pool_size": _jitter(buffer_pool_size * primary_pool_pct),
            "node_memory_MemTotal_bytes":                      total_ram,
            "node_memory_MemAvailable_bytes":                  _jitter(total_ram * 0.45),
            "mysql_global_status_threads_connected":           _jitter(85),
            "mysql_global_variables_max_connections":          connections_max,
        },
        "db-replica": {
            "mysql_global_variables_innodb_buffer_pool_size": _jitter(buffer_pool_size * replica_pool_pct),
            "node_memory_MemTotal_bytes":                      total_ram,
            "node_memory_MemAvailable_bytes":                  _jitter(total_ram * (0.08 if scenario == "critical" else 0.18)),
            "mysql_global_status_threads_connected":           _jitter(95 if scenario == "critical" else 60),
            "mysql_global_variables_max_connections":          connections_max,
            "mysql_slave_status_seconds_behind_master":        _jitter(replication_lag),
        },
    }

    return {
        "cluster_id": MYSQL_CLUSTER_ID,
        "db_type": "mysql",
        "timestamp": ts.isoformat(),
        "metrics": cluster_metrics,
        "instances": instances,
    }


# ── Scenario cycle ────────────────────────────────────────────────────────────

def get_scenario(tick: int, cycle_length: int = 10) -> str:
    """
    Cycle through scenarios over time so you can watch status changes in the UI.
    Ticks 0-4: normal, 5-7: degraded, 8-9: critical, then repeats.
    """
    pos = tick % cycle_length
    if pos < 5:
        return "normal"
    elif pos < 8:
        return "degraded"
    else:
        return "critical"


# ── HTTP push ─────────────────────────────────────────────────────────────────

async def push(client: httpx.AsyncClient, token: str, payload: dict) -> dict:
    resp = await client.post(
        f"{BASE_URL}/ingest/metrics",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
        timeout=10.0,
    )
    if resp.status_code == 401:
        logger.error("  401 Unauthorized — check your token")
        sys.exit(1)
    resp.raise_for_status()
    return resp.json()


# ── Main ──────────────────────────────────────────────────────────────────────

async def run_once(es_token: str, mysql_token: str, tick: int, fixed_scenario: str | None) -> None:
    ts = datetime.now(timezone.utc)
    es_scenario    = fixed_scenario or get_scenario(tick)
    mysql_scenario = fixed_scenario or get_scenario(tick + 2)  # offset so they don't always match

    logger.info(f"\n── Tick {tick} ── ES:{es_scenario}  MySQL:{mysql_scenario} ──")

    async with httpx.AsyncClient() as client:
        # Push ES cluster
        es_payload = build_es_payload(ts, es_scenario)
        es_result  = await push(client, es_token, es_payload)
        logger.info(
            f"  ES  → canonical={es_result['canonical_metrics_received']}  "
            f"unmapped={es_result['unmapped_metrics']}  "
            f"nodes={len(es_payload['instances'])}"
        )

        # Push MySQL cluster
        mysql_payload = build_mysql_payload(ts, mysql_scenario)
        mysql_result  = await push(client, mysql_token, mysql_payload)
        logger.info(
            f"  MySQL → canonical={mysql_result['canonical_metrics_received']}  "
            f"unmapped={mysql_result['unmapped_metrics']}  "
            f"nodes={len(mysql_payload['instances'])}"
        )

    logger.info("  Both clusters pushed — analysis running async in workers")


async def run_loop(es_token: str, mysql_token: str, interval: int, scenario: str | None) -> None:
    tick = 0
    logger.info(f"Starting simulation loop — interval: {interval}s")
    logger.info(f"  ES cluster:    {ES_CLUSTER_ID}  ({len(ES_NODES)} nodes)")
    logger.info(f"  MySQL cluster: {MYSQL_CLUSTER_ID}  ({len(MYSQL_NODES)} nodes)")
    if scenario:
        logger.info(f"  Fixed scenario: {scenario}")
    else:
        logger.info("  Scenario cycles: normal(5) → degraded(3) → critical(2) → repeat")
    logger.info(f"  Watch the dashboard at http://localhost:5173\n")

    while True:
        await run_once(es_token, mysql_token, tick, scenario)
        tick += 1
        await asyncio.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="Simulate push ingest for ES + MySQL clusters")
    parser.add_argument("--es-token",    required=True,  help="Bearer token for ES push stack")
    parser.add_argument("--mysql-token", required=True,  help="Bearer token for MySQL push stack")
    parser.add_argument("--loop",        action="store_true", help="Run continuously")
    parser.add_argument("--interval",    type=int, default=30, help="Seconds between pushes (loop mode)")
    parser.add_argument("--scenario",    choices=["normal", "degraded", "critical"],
                        help="Force a fixed scenario instead of cycling")
    parser.add_argument("--url",         default="http://localhost:8000", help="Backend base URL")
    args = parser.parse_args()

    global BASE_URL
    BASE_URL = args.url

    if args.loop:
        asyncio.run(run_loop(args.es_token, args.mysql_token, args.interval, args.scenario))
    else:
        asyncio.run(run_once(args.es_token, args.mysql_token, tick=0, fixed_scenario=args.scenario or "degraded"))


if __name__ == "__main__":
    main()
