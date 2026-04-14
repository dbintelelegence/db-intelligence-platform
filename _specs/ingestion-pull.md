# Pull Ingestion — How It Works

**Mode:** Platform queries the customer's monitoring system on a schedule.  
**Direction:** Platform → Grafana Cloud → metrics → Platform  
**Latency:** 5 minutes (one scheduler interval)  
**Auth:** Platform holds the customer's Grafana API key (stored in `stacks.api_key_ref`)

---

## Overview

```
┌─────────────────────────────────────────────────────┐
│  PLATFORM (every 5 minutes)                          │
│                                                      │
│  Scheduler wakes up                                  │
│    → reads all active clusters from DB               │
│    → for each cluster:                               │
│        GrafanaCloudAdapter.get_latest_metrics()      │
│           → fires PromQL queries at Grafana API      │
│           → returns canonical metric dict            │
│        run_cluster_from_metrics()                    │
│           → baselines → analyzers → verdicts → LLM  │
└─────────────────────────────────────────────────────┘
                        ↑
              Grafana Cloud holds the data
              Platform reads it on demand
```

---

## What the customer does

**Nothing after initial setup.** They already have Grafana Cloud. We ask for:

1. Grafana Cloud API key (read-only scope)
2. Prometheus instance ID
3. Grafana stack URL

That's stored in the `stacks` table (`api_endpoint`, `api_key_ref`). From that point on, the platform pulls silently every 5 minutes.

---

## How metrics are fetched

The adapter (`app/adapters/grafana_cloud/adapter.py`) fires PromQL queries at the Grafana Cloud Prometheus endpoint.

### Cluster-level metrics

Each canonical metric has a PromQL template. Example:

| Canonical name | PromQL query |
|---|---|
| `jvm.heap.used.percent` | `avg(elasticsearch_jvm_memory_heap_used_percent{lp_cluster="$cluster"})` |
| `gc.old.collection.seconds` | `avg(elasticsearch_jvm_gc_collection_seconds_sum{lp_cluster="$cluster"})` |
| `cluster.shards.unassigned` | `elasticsearch_cluster_health_unassigned_shards{lp_cluster="$cluster"}` |
| `thread_pool.write.rejected` | `sum(elasticsearch_thread_pool_rejected_count_total{lp_cluster="$cluster"})` |
| `mysql.replication.lag.seconds` | `avg(mysql_slave_status_seconds_behind_master{lp_cluster="$cluster"})` |
| `mysql.buffer.pool.bytes` | `avg(mysql_global_variables_innodb_buffer_pool_size{lp_cluster="$cluster"})` |

The adapter fires one HTTP request per metric, gets the latest scalar value, and assembles `dict[canonical_name, float]`.

### Per-instance metrics (ES nodes / MySQL instances)

For analyzers that need per-node data, the adapter fires a second set of queries with an `instance` label grouping:

```
avg by (instance) (
  elasticsearch_jvm_memory_heap_used_percent{lp_cluster="$cluster"}
)
```

Returns: `{"node-1": {"jvm.heap.used.percent": 61.2}, "node-2": {...}, ...}`

### Cluster identity (how Grafana knows which cluster)

Metrics in Grafana are tagged with labels. The adapter filters by:

```
lp_cluster   — cluster name  e.g. "els_shrdone_alpha_va"
lp_segment   — environment   e.g. "Alpha"
datacenter   — region        e.g. "us-east1"
```

These three combine to form the composite `cluster_id`: `"{segment}|{datacenter}|{lp_cluster}"`

---

## Derived metrics

Some canonical metrics don't exist directly in Grafana — they're computed via PromQL arithmetic inside the adapter:

| Canonical name | Computation |
|---|---|
| `jvm.heap.used.percent` | `used_bytes / max_bytes * 100` via PromQL division |
| `fs.used.percent` | `(total - available) / total * 100` |
| `mysql.connection.pct` | `threads_connected / max_connections * 100` |
| `mysql.buffer.pool.pressure.pct` | `buffer_pool_size / total_memory * 100` |

---

## Cluster registry (what gets seeded)

Before the pull scheduler can run, clusters must be seeded manually:

```bash
# Seed ES clusters
python -m app.baseline.seeder --all-alpha-es

# Seed MySQL clusters
python -m app.baseline.seeder --all-alpha-mysql
```

This fires Grafana range queries for the last 30 days and writes baseline profiles (p50/p75/p95/p99/mean/std_dev) to `baseline_profiles`.

---

## Live clusters (pull mode)

| Cluster ID | DB Type | Status |
|---|---|---|
| `Alpha\|us-east1\|els_shrdegt_alpha_va` | Elasticsearch | healthy |
| `Alpha\|us-east1\|els_shrdone_alpha_va` | Elasticsearch | healthy |
| `Alpha\|us-east1\|els_shrdsix_alpha_va` | Elasticsearch | healthy |
| `Alpha\|us-east1\|els_shrdsvn_alpha_va` | Elasticsearch | warning (JVM heap) |
| `Alpha\|us-east1\|els_sixna_alpha_va` | Elasticsearch | warning (JVM heap) |
| `Alpha\|us-east1\|mysql_aa_alpha` | MySQL | per-instance verdicts |
| `Alpha\|us-east1\|mysql_bigaa_alpha` | MySQL | per-instance verdicts |
| `Alpha\|us-east1\|mysql_mng_alpha` | MySQL | per-instance verdicts |
| `Alpha\|us-east1\|mysql_sharedaa_alpha` | MySQL | per-instance verdicts |

---

## Scheduler

File: `app/scheduler/runner_scheduler.py`  
Started: FastAPI lifespan on app startup  
Interval: `analyzer_run_interval_seconds` (default: 300s / 5 min)

```
App starts → wait 300s → run_all_active_clusters() → wait 300s → repeat
```

One cluster failure does not stop the rest. CancelledError on shutdown exits cleanly.

---

## Normalisation (pull mode)

The pull adapter uses its own PromQL templates — metric names are already canonical when returned. No normalisation map lookup needed for pull. The DB `normalisation_map` table is the source of truth for push only.

---

## Limitations of pull

| Limitation | Impact |
|---|---|
| 5-minute polling gap | Incidents detected up to 5 minutes late |
| Requires Grafana API key | Customer must give us read access to their monitoring |
| Requires internet access to Grafana | Won't work in air-gapped environments |
| Platform-driven query rate | Grafana API quota consumed by us |
| No coverage between polls | A spike that resolves in < 5 min may never be seen |

---

## Files

| File | Role |
|---|---|
| `app/adapters/grafana_cloud/adapter.py` | Fires PromQL, returns canonical metrics |
| `app/runner/analyzer_runner.py` | `run_cluster()` — pull path; `run_all_active_clusters()` — scheduler entry |
| `app/scheduler/runner_scheduler.py` | Background loop, calls `run_all_active_clusters()` |
| `app/main.py` | Starts scheduler in FastAPI lifespan |
| `app/core/config.py` | `analyzer_run_interval_seconds`, Grafana credentials |
| `backend/scripts/seed_normalisation.py` | Seeds tenant, stack, ES normalisation_map |
| `backend/scripts/seed_mysql_normalisation.py` | Seeds MySQL stack and normalisation_map |
| `backend/scripts/seed_alpha_clusters.py` | Seeds 5 Alpha ES clusters |
