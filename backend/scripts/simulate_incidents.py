"""
Incident simulation — tests accuracy of all ES + MySQL analyzers.

Pushes controlled metric payloads for each analyzer's failure mode and verifies
the verdict written to the DB matches the expected status.

Usage (from backend/):
    PYTHONPATH=. .venv/bin/python -m scripts.simulate_incidents \
        --es-token dbi_KGEw_WKxsIyaXj7XtkkTj4zCaWz7akof \
        --mysql-token dbi_TEEGXYs-T1u_pmokaQ-_vbdYZC_3DAJR

Each test:
  1. Pushes a payload with controlled metric values
  2. Waits for the analyzer worker to process it
  3. Queries the DB for the resulting verdict
  4. Asserts the expected status and prints a PASS/FAIL line
"""

import argparse
import asyncio
import logging
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import create_engine, text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

BASE_URL = "http://localhost:8000"
DB_URL   = "postgresql+psycopg2://postgres:postgres@localhost:5432/db_intelligence"

ES_CLUSTER_ID    = "Sim|us-east1|els_sim_incidents"
MYSQL_CLUSTER_ID = "Sim|us-east1|mysql_sim_incidents"

WAIT_SECS  = 8    # seconds to wait for async worker to process + write verdict
POLL_TRIES = 6    # polls × 1s each after initial wait


# ── Test case definition ──────────────────────────────────────────────────────

@dataclass
class TestCase:
    name: str
    analyzer: str
    cluster_id: str
    db_type: str
    payload_metrics: dict
    payload_instances: dict
    expected_status: str   # "healthy" | "degraded" | "critical"
    description: str


# ── Payload builders ──────────────────────────────────────────────────────────

def _j(v: float, pct: float = 0.01) -> float:
    import random
    return v * (1 + random.uniform(-pct, pct))

GB = 1024 ** 3

# Heap constants
HEAP_MAX = 8 * GB


def es_base() -> dict:
    """Healthy ES cluster-level metrics — all analyzers get these as a floor."""
    return {
        "elasticsearch_jvm_memory_used_bytes":               int(HEAP_MAX * 0.55),
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


def mysql_base() -> dict:
    """Healthy MySQL cluster-level metrics."""
    return {
        "mysql_global_status_threads_connected":         120.0,
        "mysql_global_variables_max_connections":        500.0,
        "mysql_global_status_threads_running":           10.0,
        "mysql_slave_status_seconds_behind_master":      1.0,
        "mysql_slave_status_slave_io_running":           1.0,
        "mysql_slave_status_slave_sql_running":          1.0,
        "mysql_global_variables_innodb_buffer_pool_size":4 * GB,
        "node_memory_MemTotal_bytes":                    16 * GB,
        "node_memory_MemAvailable_bytes":                6 * GB,
        "mysql_global_status_slow_queries":              5.0,
        "mysql_global_status_queries":                   95000.0,
        "node_filesystem_size_bytes":                    200 * GB,
        "node_filesystem_avail_bytes":                   120 * GB,
    }


def build_test_cases() -> list[TestCase]:
    cases = []

    # ── ES: JVM Heap Pressure ─────────────────────────────────────────────────

    # Healthy — heap at 55%
    m = es_base()
    cases.append(TestCase(
        name="JVM Heap — healthy (55%)",
        analyzer="jvm_heap_pressure",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="healthy",
        description="Heap at 55%, GC low",
    ))

    # Degraded — heap at 78%
    m = es_base()
    m["elasticsearch_jvm_memory_used_bytes"]           = int(HEAP_MAX * 0.78)
    m["elasticsearch_jvm_gc_collection_seconds_sum"]   = 0.7
    m["elasticsearch_jvm_gc_collection_seconds_count"] = 5.0
    cases.append(TestCase(
        name="JVM Heap — degraded (78%, no baseline)",
        analyzer="jvm_heap_pressure",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="degraded",
        description="Heap at 78% — above 70% degraded absolute threshold; critical requires ≥85% without baseline",
    ))

    # Critical — heap at 91%
    m = es_base()
    m["elasticsearch_jvm_memory_used_bytes"]           = int(HEAP_MAX * 0.91)
    m["elasticsearch_jvm_gc_collection_seconds_sum"]   = 1.8
    m["elasticsearch_jvm_gc_collection_seconds_count"] = 12.0
    cases.append(TestCase(
        name="JVM Heap — critical (91%)",
        analyzer="jvm_heap_pressure",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="critical",
        description="Heap at 91%, GC thrashing",
    ))

    # ── ES: Shard Allocation Failure ──────────────────────────────────────────

    # Healthy — all shards assigned
    m = es_base()
    cases.append(TestCase(
        name="Shard Allocation — healthy (0 unassigned)",
        analyzer="shard_allocation_failure",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="healthy",
        description="Zero unassigned shards",
    ))

    # Critical — 5 unassigned shards
    m = es_base()
    m["elasticsearch_cluster_health_unassigned_shards"] = 5.0
    m["elasticsearch_cluster_health_status"]            = 0.0  # red
    cases.append(TestCase(
        name="Shard Allocation — degraded (5 unassigned, not-green status)",
        analyzer="shard_allocation_failure",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="degraded",
        description="5 unassigned shards — adapter encodes red/yellow as 0.0, cannot distinguish, maps to degraded",
    ))

    # ── ES: Thread Pool Saturation ────────────────────────────────────────────

    # Healthy — queue empty
    m = es_base()
    cases.append(TestCase(
        name="Thread Pool — healthy (queue=0)",
        analyzer="thread_pool_saturation",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="healthy",
        description="Write queue empty, no rejections",
    ))

    # Critical — rejections happening
    m = es_base()
    m["elasticsearch_thread_pool_rejected_count"] = 25.0
    m["elasticsearch_thread_pool_queue_count"]    = 200.0
    cases.append(TestCase(
        name="Thread Pool — critical (25 rejections)",
        analyzer="thread_pool_saturation",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="critical",
        description="25 write rejections, queue at 200",
    ))

    # ── ES: Fielddata Circuit Breaker ─────────────────────────────────────────

    # Healthy — zero evictions, zero trips (using increase() values)
    m = es_base()
    m["elasticsearch_indices_fielddata_evictions"]         = 0.0
    m["elasticsearch_indices_fielddata_memory_size_bytes"] = 50 * 1024 * 1024
    m["elasticsearch_breakers_tripped"]                    = 0.0
    cases.append(TestCase(
        name="Fielddata CB — healthy (0 trips, 0 evictions)",
        analyzer="fielddata_circuit_breaker",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="healthy",
        description="No breaker activity, fielddata low",
    ))

    # Critical — breaker tripped in last 5m (increase() value > 0)
    m = es_base()
    m["elasticsearch_indices_fielddata_evictions"]         = 45.0   # 45 evictions last 5m
    m["elasticsearch_indices_fielddata_memory_size_bytes"] = 400 * 1024 * 1024  # 400 MB
    m["elasticsearch_breakers_tripped"]                    = 12.0   # 12 trips last 5m
    cases.append(TestCase(
        name="Fielddata CB — critical (12 trips last 5m)",
        analyzer="fielddata_circuit_breaker",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="critical",
        description="12 breaker trips in last 5 minutes, 400 MB fielddata",
    ))

    # ── ES: Disk Watermark ────────────────────────────────────────────────────

    # Healthy — 40% used
    m = es_base()
    m["node_filesystem_size_bytes"]  = 500 * GB
    m["node_filesystem_avail_bytes"] = 300 * GB   # 40% used
    cases.append(TestCase(
        name="Disk Watermark — healthy (40% used)",
        analyzer="disk_watermark",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="healthy",
        description="Disk 40% used, well below watermarks",
    ))

    # Critical — 93% used (above 90% high watermark)
    m = es_base()
    m["node_filesystem_size_bytes"]  = 500 * GB
    m["node_filesystem_avail_bytes"] = int(500 * GB * 0.07)  # 93% used
    cases.append(TestCase(
        name="Disk Watermark — critical (93% used)",
        analyzer="disk_watermark",
        cluster_id=ES_CLUSTER_ID, db_type="elasticsearch",
        payload_metrics=m, payload_instances={},
        expected_status="critical",
        description="Disk 93% used, above high watermark (90%)",
    ))

    # ── MySQL: Connection Pool ────────────────────────────────────────────────

    # Healthy — 24% connections used
    m = mysql_base()
    m["mysql_global_status_threads_connected"]   = 120.0
    m["mysql_global_variables_max_connections"]  = 500.0
    m["mysql_global_status_threads_running"]     = 10.0
    cases.append(TestCase(
        name="MySQL Connection Pool — healthy (24%)",
        analyzer="mysql_connection_pool_saturation",
        cluster_id=MYSQL_CLUSTER_ID, db_type="mysql",
        payload_metrics=m, payload_instances={},
        expected_status="healthy",
        description="Connection pool at 24%, threads healthy",
    ))

    # Critical — 94% connections (470/500)
    m = mysql_base()
    m["mysql_global_status_threads_connected"]   = 470.0
    m["mysql_global_variables_max_connections"]  = 500.0
    m["mysql_global_status_threads_running"]     = 8.0   # leak pattern: low threads
    m["mysql_global_status_slow_queries"]        = 5.0
    m["mysql_global_status_queries"]             = 95000.0
    cases.append(TestCase(
        name="MySQL Connection Pool — critical (94%, leak pattern)",
        analyzer="mysql_connection_pool_saturation",
        cluster_id=MYSQL_CLUSTER_ID, db_type="mysql",
        payload_metrics=m, payload_instances={},
        expected_status="critical",
        description="470/500 connections, few threads active = connection leak",
    ))

    # ── MySQL: Replication Lag ────────────────────────────────────────────────

    # Healthy — 1s lag
    m = mysql_base()
    m["mysql_slave_status_seconds_behind_master"] = 1.0
    cases.append(TestCase(
        name="MySQL Replication Lag — healthy (1s)",
        analyzer="mysql_replication_lag",
        cluster_id=MYSQL_CLUSTER_ID, db_type="mysql",
        payload_metrics=m, payload_instances={},
        expected_status="healthy",
        description="Replication lag 1 second",
    ))

    # Critical — 120s lag
    m = mysql_base()
    m["mysql_slave_status_seconds_behind_master"] = 120.0
    cases.append(TestCase(
        name="MySQL Replication Lag — critical (120s)",
        analyzer="mysql_replication_lag",
        cluster_id=MYSQL_CLUSTER_ID, db_type="mysql",
        payload_metrics=m, payload_instances={},
        expected_status="critical",
        description="Replication lag 120 seconds",
    ))

    # ── MySQL: InnoDB Buffer Pool (per-instance) ──────────────────────────────

    # Healthy — 55% pressure
    m = mysql_base()
    instances = {
        "db-primary": {
            "mysql_global_variables_innodb_buffer_pool_size": int(4 * GB * 0.55),
            "node_memory_MemTotal_bytes":                      16 * GB,
            "node_memory_MemAvailable_bytes":                  int(16 * GB * 0.45),
            "mysql_global_status_threads_connected":           85.0,
            "mysql_global_variables_max_connections":          500.0,
        },
    }
    cases.append(TestCase(
        name="InnoDB Buffer Pool — healthy (55%)",
        analyzer="mysql_innodb_buffer_pool_pressure",
        cluster_id=MYSQL_CLUSTER_ID, db_type="mysql",
        payload_metrics=m, payload_instances=instances,
        expected_status="healthy",
        description="Buffer pool at 55% of available RAM",
    ))

    # Critical — buffer pool = 14.7GB on 16GB machine = 92% of total RAM
    m = mysql_base()
    instances = {
        "db-primary": {
            "mysql_global_variables_innodb_buffer_pool_size": int(16 * GB * 0.92),  # 92% of total RAM
            "node_memory_MemTotal_bytes":                      16 * GB,
            "node_memory_MemAvailable_bytes":                  int(16 * GB * 0.06),
            "mysql_global_status_threads_connected":           85.0,
            "mysql_global_variables_max_connections":          500.0,
        },
    }
    cases.append(TestCase(
        name="InnoDB Buffer Pool — critical (92% of total RAM)",
        analyzer="mysql_innodb_buffer_pool_pressure",
        cluster_id=MYSQL_CLUSTER_ID, db_type="mysql",
        payload_metrics=m, payload_instances=instances,
        expected_status="critical",
        description="Buffer pool = 14.7GB on 16GB machine = 92% of total RAM",
    ))

    return cases


# ── HTTP + DB helpers ─────────────────────────────────────────────────────────

async def push_metrics(client: httpx.AsyncClient, token: str, cluster_id: str,
                       db_type: str, metrics: dict, instances: dict) -> None:
    payload = {
        "cluster_id": cluster_id,
        "db_type": db_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
        "instances": instances,
    }
    resp = await client.post(
        f"{BASE_URL}/ingest/metrics",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
        timeout=10.0,
    )
    if resp.status_code == 401:
        logger.error("401 Unauthorized — check token")
        sys.exit(1)
    resp.raise_for_status()


async def get_latest_verdict(cluster_id: str, analyzer_name: str,
                             since_ts: datetime, instance_id: str | None = None) -> dict | None:
    import asyncpg
    conn = await asyncpg.connect("postgresql://postgres:postgres@localhost:5432/db_intelligence")
    try:
        row = await conn.fetchrow("""
            SELECT v.status, v.observed, v.run_at
            FROM verdicts v
            JOIN clusters c ON c.id = v.cluster_id
            WHERE c.cluster_id = $1
              AND v.analyzer_name = $2
              AND v.run_at >= $3
              AND ($4::text IS NULL OR v.instance_id = $4)
            ORDER BY v.run_at DESC
            LIMIT 1
        """, cluster_id, analyzer_name, since_ts, instance_id)
        if row:
            return {"status": row["status"], "observed": row["observed"], "run_at": row["run_at"]}
    finally:
        await conn.close()
    return None


# ── Test runner ───────────────────────────────────────────────────────────────

async def run_test(tc: TestCase, es_token: str, mysql_token: str,
                   verbose: bool, test_idx: int, run_id: str) -> bool:
    token = es_token if tc.db_type == "elasticsearch" else mysql_token
    # Use run_id + test_idx so each run gets fresh cluster IDs — skip-if-unchanged never suppresses
    cluster_id = tc.cluster_id + f"_{run_id}_{test_idx}"
    pushed_at = datetime.now(timezone.utc)

    async with httpx.AsyncClient() as client:
        await push_metrics(client, token, cluster_id, tc.db_type,
                           tc.payload_metrics, tc.payload_instances)

    # Poll for verdict
    verdict = None
    await asyncio.sleep(WAIT_SECS)
    for _ in range(POLL_TRIES):
        verdict = await get_latest_verdict(cluster_id, tc.analyzer, pushed_at)
        if verdict:
            break
        await asyncio.sleep(1)

    if not verdict:
        print(f"  FAIL  {tc.name}")
        print(f"        No verdict written after {WAIT_SECS + POLL_TRIES}s")
        return False

    actual = verdict["status"].value if hasattr(verdict["status"], "value") else str(verdict["status"])
    passed = actual == tc.expected_status

    icon = "  PASS" if passed else "  FAIL"
    print(f"{icon}  {tc.name}")
    if not passed:
        print(f"        expected={tc.expected_status}  got={actual}")
        print(f"        observed: {verdict['observed'][:120]}")
    elif verbose:
        print(f"        status={actual}  observed: {verdict['observed'][:100]}")

    return passed


async def main_async(es_token: str, mysql_token: str, verbose: bool,
                     filter_analyzer: str | None) -> None:
    cases = build_test_cases()
    if filter_analyzer:
        cases = [c for c in cases if filter_analyzer in c.analyzer]
        if not cases:
            print(f"No test cases match analyzer filter: {filter_analyzer}")
            sys.exit(1)

    # Short timestamp-based run ID ensures unique cluster IDs across runs
    run_id = datetime.now(timezone.utc).strftime("%m%d%H%M%S")

    print(f"\n{'='*60}")
    print(f"  DB Intelligence — Analyzer Accuracy Test")
    print(f"  {len(cases)} test cases across {len(set(c.analyzer for c in cases))} analyzers")
    print(f"  run_id={run_id}")
    print(f"{'='*60}\n")

    passed = 0
    failed = 0
    for idx, tc in enumerate(cases):
        ok = await run_test(tc, es_token, mysql_token, verbose, idx, run_id)
        if ok:
            passed += 1
        else:
            failed += 1
        # Small gap between tests so verdicts don't collide
        await asyncio.sleep(2)

    print(f"\n{'='*60}")
    print(f"  Results: {passed} passed, {failed} failed / {len(cases)} total")
    if failed == 0:
        print("  All analyzers producing correct verdicts.")
    else:
        print("  *** Some analyzers need attention — see FAIL lines above ***")
    print(f"{'='*60}\n")

    sys.exit(0 if failed == 0 else 1)


def main():
    parser = argparse.ArgumentParser(description="Simulate incidents and test analyzer accuracy")
    parser.add_argument("--es-token",    required=True)
    parser.add_argument("--mysql-token", required=True)
    parser.add_argument("--verbose",     action="store_true", help="Show observed text on PASS too")
    parser.add_argument("--analyzer",    help="Filter to one analyzer name (e.g. fielddata_circuit_breaker)")
    parser.add_argument("--url",         default="http://localhost:8000")
    args = parser.parse_args()

    global BASE_URL
    BASE_URL = args.url

    asyncio.run(main_async(args.es_token, args.mysql_token, args.verbose, args.analyzer))


if __name__ == "__main__":
    main()
