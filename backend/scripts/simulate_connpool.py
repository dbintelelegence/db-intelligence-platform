"""
Connection Pool Pattern Simulator

Pushes three distinct connection pool saturation scenarios to the backend
so you can watch the analyzer classify them differently in the UI.

  leak    — 85% connections, 3% threads active (app not returning to pool)
  pileup  — 85% connections, slow query rate 1.2/s, threads elevated
  surge   — 85% connections, query rate 2.8x baseline, threads proportional

Usage:
    cd backend
    python scripts/simulate_connpool.py --token dbi_xxx --scenario leak
    python scripts/simulate_connpool.py --token dbi_xxx --scenario pileup
    python scripts/simulate_connpool.py --token dbi_xxx --scenario surge
    python scripts/simulate_connpool.py --token dbi_xxx --scenario normal

    # Cycle through all scenarios automatically (every 30s):
    python scripts/simulate_connpool.py --token dbi_xxx --loop

Watch the dashboard at http://localhost:5173
"""

import argparse
import asyncio
import logging
import random
from datetime import datetime, timezone

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

BASE_URL    = "http://localhost:8000"
CLUSTER_ID  = "Sim|us-east1|mysql_connpool_sim"
MAX_CONNS   = 200.0


def _jitter(base: float, pct: float = 0.03) -> float:
    return base * (1 + random.uniform(-pct, pct))


def build_payload(ts: datetime, scenario: str) -> dict:
    """
    Build a MySQL push payload for the given connection pool scenario.

    Baselines seeded from previous runs will be ~50% connections, ~10 threads,
    ~1000 queries/s. Scenarios push those values into anomaly territory.

    Scenario details:
      normal  — 52% connections, 11 threads active (utilization 21%), low slow queries
      leak    — 85% connections (170 conns), 5 threads active (utilization 3%)
                slow query rate 0.1/s, query rate flat → LEAK pattern
      pileup  — 85% connections (170 conns), 20 threads active (11% util)
                slow query rate 1.2/s, threads 2σ above baseline → PILEUP pattern
      surge   — 85% connections (170 conns), 30 threads active (18% util)
                query rate 1,400/s (2.0σ above baseline of 1,000/s) → SURGE pattern
    """
    if scenario == "leak":
        threads_connected = 170.0
        threads_running   = 5.0       # 3% utilization — mostly sleeping
        slow_query_rate   = 0.1       # flat — not a query problem
        query_rate        = 980.0     # normal
        replication_lag   = 1.2
        label             = "LEAK — connections open but idle (app not returning to pool)"

    elif scenario == "pileup":
        threads_connected = 170.0
        threads_running   = 20.0      # 12% utilization, 2σ above baseline
        slow_query_rate   = 1.2       # high — queries holding connections
        query_rate        = 950.0     # roughly normal — it's not more traffic
        replication_lag   = 2.5
        label             = "PILE-UP — slow queries holding connections open"

    elif scenario == "surge":
        threads_connected = 170.0
        threads_running   = 30.0      # 18% utilization, 4σ above baseline
        slow_query_rate   = 0.1       # low — queries are fast, just more of them
        query_rate        = 1400.0    # 2.0σ above baseline — genuine traffic surge
        replication_lag   = 3.0
        label             = "SURGE — genuine traffic increase, connections proportional"

    else:  # normal
        threads_connected = 104.0
        threads_running   = 11.0
        slow_query_rate   = 0.05
        query_rate        = 1020.0
        replication_lag   = 1.1
        label             = "NORMAL — all within baseline"

    conn_pct = threads_connected / MAX_CONNS * 100

    logger.info(f"  Scenario: {scenario.upper()}")
    logger.info(f"  {label}")
    logger.info(f"  connections={threads_connected:.0f}/{MAX_CONNS:.0f} ({conn_pct:.0f}%)  "
                f"threads_running={threads_running:.0f}  "
                f"utilization={threads_running/threads_connected*100:.0f}%")
    logger.info(f"  slow_query_rate={slow_query_rate:.2f}/s  "
                f"query_rate={query_rate:.0f}/s  "
                f"replication_lag={replication_lag:.1f}s")

    # Build raw Prometheus-style metrics (will be normalised by the ingest pipeline)
    cluster_metrics = {
        # Connection pool
        "mysql_global_status_threads_connected":    _jitter(threads_connected, 0.01),
        "mysql_global_variables_max_connections":   MAX_CONNS,
        "mysql_global_status_threads_running":      _jitter(threads_running, 0.05),

        # Query signals
        "mysql_global_status_slow_queries":         _jitter(slow_query_rate * 300, 0.05),  # cumulative (5min window)
        "mysql_global_status_queries":              _jitter(query_rate * 300, 0.02),        # cumulative (5min window)

        # Replication
        "mysql_slave_status_seconds_behind_master": _jitter(replication_lag, 0.1),
        "mysql_slave_status_slave_io_running":      1.0,
        "mysql_slave_status_slave_sql_running":     1.0,

        # Memory / buffer pool (healthy — not the problem here)
        "mysql_global_variables_innodb_buffer_pool_size": 4 * 1024**3,  # 4 GB
        "node_memory_MemTotal_bytes":                     16 * 1024**3,  # 16 GB
        "node_memory_MemAvailable_bytes":                 _jitter(8 * 1024**3, 0.05),

        # Disk (healthy)
        "node_filesystem_size_bytes":   200 * 1024**3,
        "node_filesystem_avail_bytes":  _jitter(130 * 1024**3, 0.02),
    }

    return {
        "cluster_id": CLUSTER_ID,
        "db_type":    "mysql",
        "timestamp":  ts.isoformat(),
        "metrics":    cluster_metrics,
        "instances":  {},   # connection pool saturation is cluster-level
    }


async def push_once(token: str, scenario: str) -> None:
    ts      = datetime.now(timezone.utc)
    payload = build_payload(ts, scenario)

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{BASE_URL}/ingest/metrics",
            headers={"Authorization": f"Bearer {token}"},
            json=payload,
            timeout=10.0,
        )

    if resp.status_code == 401:
        logger.error("  401 Unauthorized — token is invalid or inactive")
        raise SystemExit(1)
    if resp.status_code == 202:
        body = resp.json()
        logger.info(
            f"  → 202 Accepted  "
            f"canonical={body.get('canonical_metrics_received', '?')}  "
            f"unmapped={body.get('unmapped_metrics', '?')}  "
            f"queued for analysis"
        )
        logger.info(f"  Watch: http://localhost:5173")
    else:
        logger.error(f"  Unexpected status {resp.status_code}: {resp.text}")


SCENARIO_CYCLE = ["normal", "normal", "leak", "leak", "pileup", "pileup", "surge", "surge"]


async def run_loop(token: str, interval: int) -> None:
    logger.info(f"Starting connection pool simulation loop (interval={interval}s)")
    logger.info(f"  Cluster: {CLUSTER_ID}")
    logger.info(f"  Cycle: normal → leak → pileup → surge → repeat")
    logger.info(f"  Watch the dashboard at http://localhost:5173\n")

    tick = 0
    while True:
        scenario = SCENARIO_CYCLE[tick % len(SCENARIO_CYCLE)]
        logger.info(f"\n── Tick {tick} ──────────────────────────────────────────")
        await push_once(token, scenario)
        tick += 1
        await asyncio.sleep(interval)


def main():
    parser = argparse.ArgumentParser(description="Simulate MySQL connection pool patterns")
    parser.add_argument("--token",    required=True,
                        help="Bearer token from: python scripts/issue_ingest_token.py ...")
    parser.add_argument("--scenario", choices=["normal", "leak", "pileup", "surge"],
                        default="leak",
                        help="Which pattern to push (default: leak)")
    parser.add_argument("--loop",     action="store_true",
                        help="Cycle through all scenarios automatically")
    parser.add_argument("--interval", type=int, default=30,
                        help="Seconds between pushes in loop mode (default: 30)")
    parser.add_argument("--url",      default="http://localhost:8000",
                        help="Backend base URL (default: http://localhost:8000)")
    args = parser.parse_args()

    global BASE_URL
    BASE_URL = args.url

    logger.info("Connection Pool Pattern Simulator")
    logger.info(f"  Backend: {BASE_URL}")
    logger.info(f"  Cluster: {CLUSTER_ID}\n")

    if args.loop:
        asyncio.run(run_loop(args.token, args.interval))
    else:
        asyncio.run(push_once(args.token, args.scenario))


if __name__ == "__main__":
    main()
