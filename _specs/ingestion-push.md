# Push Ingestion — How It Works

**Mode:** Customer's monitoring agent pushes metrics to the platform endpoint.  
**Direction:** Customer infrastructure → Platform  
**Latency:** < 5 seconds (analysis runs as soon as metrics arrive)  
**Auth:** Bearer token issued by platform, SHA-256 stored in `ingest_tokens` table

---

## Overview

```
┌─────────────────────────────────────────────────────┐
│  CUSTOMER INFRASTRUCTURE                             │
│                                                      │
│  Prometheus / OTEL / custom agent                    │
│    → POST /ingest/metrics every 30-60s               │
│    → bearer token in Authorization header            │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  PLATFORM INGEST LAYER                               │
│                                                      │
│  1. Validate bearer token → tenant_id + stack_id    │
│  2. Parse JSON payload                               │
│  3. Auto-create cluster if new                       │
│  4. Normalise raw metric names → canonical names     │
│  5. Compute derived metrics (heap%, pressure%, ...)  │
│  6. Upsert cluster_metric_registry                   │
│  7. Record unknown metrics → unmapped_metrics        │
│  8. Enqueue AnalysisJob → worker queue               │
│  9. Return 202 Accepted (never block on analysis)    │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  WORKER QUEUE  (3 coroutines, asyncio.Queue(500))    │
│                                                      │
│  run_cluster_from_metrics()                          │
│    → baselines → analyzers → verdicts → LLM          │
└─────────────────────────────────────────────────────┘
```

---

## Payload format

```
POST /ingest/metrics
Authorization: Bearer dbi_<token>
Content-Type: application/json
```

### Schema

```json
{
  "cluster_id": "Prod|us-east1|els_search_primary",
  "db_type":    "elasticsearch",
  "timestamp":  "2026-04-14T16:00:00Z",
  "metrics":    { "<raw_metric_name>": <float>, ... },
  "instances":  { "<node_id>": { "<raw_metric_name>": <float>, ... }, ... }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `cluster_id` | Yes | Composite key: `"{segment}\|{region}\|{cluster_name}"` |
| `db_type` | Yes | `elasticsearch` \| `mysql` \| `postgres` \| `cassandra` |
| `timestamp` | Yes | ISO-8601 UTC — when the metrics were scraped |
| `metrics` | One of | Cluster-level aggregates (averages/totals across all nodes) |
| `instances` | One of | Per-node breakdown: `{node_id: {metric: value}}` |

At least one of `metrics` or `instances` must be present.

---

## Example: Elasticsearch cluster, 4 nodes

```json
{
  "cluster_id": "Prod|us-east1|els_search_primary",
  "db_type": "elasticsearch",
  "timestamp": "2026-04-14T16:00:00Z",
  "metrics": {
    "elasticsearch_jvm_memory_used_bytes":            6510000000,
    "elasticsearch_jvm_memory_max_bytes":             8589934592,
    "elasticsearch_jvm_gc_collection_seconds_sum":    0.65,
    "elasticsearch_jvm_gc_collection_seconds_count":  4.5,
    "elasticsearch_cluster_health_unassigned_shards": 0.0,
    "elasticsearch_thread_pool_rejected_count":       2.0,
    "elasticsearch_indices_fielddata_evictions":      12.0,
    "elasticsearch_indices_search_query_total":       4440.0,
    "node_filesystem_size_bytes":                     536870912000,
    "node_filesystem_avail_bytes":                    308000000000,
    "node_memory_MemTotal_bytes":                     34359738368,
    "node_memory_MemAvailable_bytes":                 19000000000
  },
  "instances": {
    "node-1": {
      "elasticsearch_jvm_memory_used_bytes":           5025000000,
      "elasticsearch_jvm_memory_max_bytes":            8589934592,
      "elasticsearch_jvm_gc_collection_seconds_sum":   0.24,
      "elasticsearch_jvm_gc_collection_seconds_count": 2.2,
      "elasticsearch_thread_pool_rejected_count":      0.0
    },
    "node-2": {
      "elasticsearch_jvm_memory_used_bytes":           5116000000,
      "elasticsearch_jvm_memory_max_bytes":            8589934592,
      "elasticsearch_jvm_gc_collection_seconds_sum":   0.29,
      "elasticsearch_jvm_gc_collection_seconds_count": 2.2,
      "elasticsearch_thread_pool_rejected_count":      0.0
    },
    "node-3": {
      "elasticsearch_jvm_memory_used_bytes":           7558000000,
      "elasticsearch_jvm_memory_max_bytes":            8589934592,
      "elasticsearch_jvm_gc_collection_seconds_sum":   1.40,
      "elasticsearch_jvm_gc_collection_seconds_count": 9.0,
      "elasticsearch_thread_pool_rejected_count":      15.0
    },
    "node-4": {
      "elasticsearch_jvm_memory_used_bytes":           4935000000,
      "elasticsearch_jvm_memory_max_bytes":            8589934592,
      "elasticsearch_jvm_gc_collection_seconds_sum":   0.26,
      "elasticsearch_jvm_gc_collection_seconds_count": 2.2,
      "elasticsearch_thread_pool_rejected_count":      0.0
    }
  }
}
```

Response:
```json
{
  "status": "accepted",
  "cluster_id": "Prod|us-east1|els_search_primary",
  "canonical_metrics_received": 21,
  "unmapped_metrics": 0
}
```

---

## Example: MySQL cluster, 2 nodes

```json
{
  "cluster_id": "Prod|us-east1|mysql_orders_primary",
  "db_type": "mysql",
  "timestamp": "2026-04-14T16:00:00Z",
  "metrics": {
    "mysql_global_status_threads_connected":           120.0,
    "mysql_global_variables_max_connections":          500.0,
    "mysql_global_status_threads_running":             12.0,
    "mysql_slave_status_seconds_behind_master":        8.0,
    "mysql_slave_status_slave_io_running":             1.0,
    "mysql_slave_status_slave_sql_running":            1.0,
    "mysql_global_variables_innodb_buffer_pool_size":  4294967296,
    "node_memory_MemTotal_bytes":                      17179869184,
    "node_memory_MemAvailable_bytes":                  6604069168,
    "mysql_global_status_slow_queries":                8.0,
    "mysql_global_status_queries":                     95000.0,
    "node_filesystem_size_bytes":                      214748364800,
    "node_filesystem_avail_bytes":                     132000000000
  },
  "instances": {
    "db-primary": {
      "mysql_global_variables_innodb_buffer_pool_size": 2210000000,
      "node_memory_MemTotal_bytes":                     17179869184,
      "node_memory_MemAvailable_bytes":                 7700000000,
      "mysql_global_status_threads_connected":          85.0,
      "mysql_global_variables_max_connections":         500.0
    },
    "db-replica": {
      "mysql_global_variables_innodb_buffer_pool_size": 3900000000,
      "node_memory_MemTotal_bytes":                     17179869184,
      "node_memory_MemAvailable_bytes":                 1800000000,
      "mysql_global_status_threads_connected":          60.0,
      "mysql_global_variables_max_connections":         500.0,
      "mysql_slave_status_seconds_behind_master":       8.0
    }
  }
}
```

---

## Supported metric names

### Elasticsearch

| Raw metric name (what you send) | Canonical name (internal) | Category | Unit |
|---|---|---|---|
| `elasticsearch_jvm_memory_used_bytes` | `jvm.heap.used.bytes` | jvm | bytes |
| `elasticsearch_jvm_memory_max_bytes` | `jvm.heap.max.bytes` | jvm | bytes |
| `elasticsearch_jvm_gc_collection_seconds_sum` | `gc.old.collection.seconds` | jvm | seconds |
| `elasticsearch_jvm_gc_collection_seconds_count` | `gc.old.collection.count` | jvm | count |
| `elasticsearch_jvm_memory_committed_bytes` | `jvm.memory.committed.bytes` | jvm | bytes |
| `elasticsearch_thread_pool_rejected_count` | `thread_pool.write.rejected` | io | count |
| `elasticsearch_thread_pool_queue_count` | `thread_pool.write.queue` | io | count |
| `elasticsearch_thread_pool_active_count` | `thread_pool.write.active` | io | count |
| `elasticsearch_cluster_health_unassigned_shards` | `cluster.shards.unassigned` | shard | count |
| `elasticsearch_cluster_health_active_shards` | `cluster.shards.active` | shard | count |
| `elasticsearch_cluster_health_active_primary_shards` | `cluster.shards.active.primary` | shard | count |
| `elasticsearch_cluster_health_relocating_shards` | `cluster.shards.relocating` | shard | count |
| `elasticsearch_cluster_health_initializing_shards` | `cluster.shards.initializing` | shard | count |
| `elasticsearch_cluster_health_delayed_unassigned_shards` | `cluster.shards.delayed.unassigned` | shard | count |
| `elasticsearch_cluster_health_status` | `cluster.health.status` | shard | status |
| `elasticsearch_cluster_health_number_of_nodes` | `cluster.nodes.total` | cluster | count |
| `elasticsearch_cluster_health_number_of_data_nodes` | `cluster.nodes.data` | cluster | count |
| `elasticsearch_cluster_health_number_of_pending_tasks` | `cluster.pending.tasks` | cluster | count |
| `elasticsearch_indices_fielddata_evictions` | `fielddata.evictions` | cache | count |
| `elasticsearch_indices_fielddata_memory_size_bytes` | `fielddata.memory.bytes` | cache | bytes |
| `elasticsearch_breakers_tripped` | `circuit_breaker.tripped` | memory | count |
| `elasticsearch_indices_search_query_total` | `search.query.total` | search | count |
| `elasticsearch_indices_search_query_time_seconds` | `search.query.time.ms` | search | ms |
| `elasticsearch_indices_search_fetch_total` | `search.fetch.total` | search | count |
| `elasticsearch_indices_search_fetch_time_seconds` | `search.fetch.time.seconds` | search | seconds |
| `elasticsearch_indices_indexing_index_total` | `indexing.index.total` | indexing | count |
| `elasticsearch_indices_indexing_index_time_seconds_total` | `indexing.index.time.seconds` | indexing | seconds |
| `elasticsearch_indices_indexing_delete_total` | `indexing.delete.total` | indexing | count |
| `elasticsearch_indices_store_size_bytes_total` | `indices.store.size.bytes` | indexing | bytes |
| `elasticsearch_indices_segments_count` | `indices.segments.count` | indexing | count |
| `elasticsearch_indices_merges_total` | `indices.merges.total` | indexing | count |
| `elasticsearch_indices_refresh_total` | `indices.refresh.total` | indexing | count |
| `elasticsearch_process_open_files_count` | `process.open.files` | process | count |
| `elasticsearch_process_max_files_descriptors` | `process.max.files` | process | count |
| `node_filesystem_size_bytes` | `fs.total.total.bytes` | disk | bytes |
| `node_filesystem_avail_bytes` | `fs.total.available.bytes` | disk | bytes |
| `node_filesystem_free_bytes` | `fs.total.free.bytes` | disk | bytes |
| `node_memory_MemTotal_bytes` | `memory.total.bytes` | memory | bytes |
| `node_memory_MemAvailable_bytes` | `memory.available.bytes` | memory | bytes |
| `node_cpu_seconds_total` | `cpu.seconds.total` | cpu | seconds |
| `node_disk_read_bytes_total` | `disk.read.bytes` | disk | bytes |
| `node_disk_written_bytes_total` | `disk.written.bytes` | disk | bytes |
| `node_network_receive_bytes_total` | `network.receive.bytes` | network | bytes |
| `node_network_transmit_bytes_total` | `network.transmit.bytes` | network | bytes |
| `up` | `scrape.up` | cluster | bool |

### MySQL

| Raw metric name (what you send) | Canonical name (internal) | Category | Unit |
|---|---|---|---|
| `mysql_global_status_threads_connected` | `mysql.connections.current` | connections | count |
| `mysql_global_variables_max_connections` | `mysql.connections.max` | connections | count |
| `mysql_global_status_threads_running` | `mysql.threads.running` | connections | count |
| `mysql_slave_status_seconds_behind_master` | `mysql.replication.lag.seconds` | replication | seconds |
| `mysql_slave_status_slave_io_running` | `mysql.replication.io.running` | replication | bool |
| `mysql_slave_status_slave_sql_running` | `mysql.replication.sql.running` | replication | bool |
| `mysql_global_variables_innodb_buffer_pool_size` | `mysql.buffer.pool.bytes` | memory | bytes |
| `node_memory_MemTotal_bytes` | `mysql.memory.total.bytes` | memory | bytes |
| `node_memory_MemAvailable_bytes` | `mysql.memory.available.bytes` | memory | bytes |
| `mysql_global_status_slow_queries` | `mysql.slow.queries.total` | query | count |
| `mysql_global_status_queries` | `mysql.queries.total` | query | count |
| `mysql_global_status_select_full_join` | `mysql.select.full.join` | query | count |
| `mysql_global_status_created_tmp_disk_tables` | `mysql.tmp.disk.tables` | query | count |
| `mysql_global_status_table_locks_waited` | `mysql.table.locks.waited` | locks | count |
| `mysql_global_status_innodb_row_ops_total` | `mysql.innodb.row.ops.total` | innodb | count |
| `node_filesystem_size_bytes` | `mysql.disk.total.bytes` | disk | bytes |
| `node_filesystem_avail_bytes` | `mysql.disk.available.bytes` | disk | bytes |
| `node_cpu_seconds_total` | `mysql.cpu.seconds.total` | cpu | seconds |

---

## Derived metrics (computed automatically at ingest)

You never need to send these — the platform computes them from the raw bytes you push:

| Derived canonical name | Inputs required | Formula |
|---|---|---|
| `jvm.heap.used.percent` | `jvm.heap.used.bytes` + `jvm.heap.max.bytes` | `used / max × 100` |
| `fs.used.percent` | `fs.total.total.bytes` + `fs.total.available.bytes` | `(total − available) / total × 100` |
| `mysql.connection.pct` | `mysql.connections.current` + `mysql.connections.max` | `current / max × 100` |
| `mysql.buffer.pool.pressure.pct` | `mysql.buffer.pool.bytes` + `mysql.memory.total.bytes` | `pool / total × 100` |

---

## Authentication

### Issuing a token

```bash
cd backend
python -m scripts.issue_ingest_token \
  --tenant-name "Acme Corp" \
  --db-type elasticsearch \
  --label "prod-prometheus"
```

Output (raw token shown once — store securely):
```
Token: dbi_MUiERwKX8BWnkFPe2ZA5y8Pg7lXr1PLm
Stack: Acme Corp — elasticsearch (push)
```

### Token security model

- Platform generates a cryptographically random 32-byte token with `dbi_` prefix
- Only `SHA-256(raw_token)` is stored in the DB — plaintext never persisted
- Token is shown once at creation and never again
- Revoke with: `python -m scripts.issue_ingest_token --revoke <token-id>`

---

## Customer setup (Prometheus remote_write)

Add to `prometheus.yml`:

```yaml
remote_write:
  - url: https://api.dbintelligence.io/ingest/metrics
    authorization:
      credentials: dbi_MUiERwKX8BWnkFPe2ZA5y8Pg7lXr1PLm
    write_relabel_configs:
      # Only forward DB and node metrics — drop everything else
      - source_labels: [__name__]
        regex: "elasticsearch_.*|mysql_.*|node_.*"
        action: keep
      # Build cluster_id from existing labels
      - source_labels: [lp_segment, datacenter, lp_cluster]
        separator: "|"
        target_label: cluster_id
        action: replace
```

The `cluster_id` relabeling rule is the only customer-side configuration required beyond the token.

---

## What happens with unknown metrics

Any metric name not in the normalisation map is:
- **Never rejected** — the push still returns 202
- **Recorded** in `unmapped_metrics` table with `occurrence_count`
- **Reviewed** by the product team and added to the normalisation map
- **Automatically normalised** on subsequent pushes once mapped (5-min cache TTL)

---

## cluster_id format

```
"{segment}|{region}|{cluster_name}"

Examples:
  "Prod|us-east1|els_search_primary"
  "Staging|eu-west1|mysql_orders"
  "Alpha|us-east1|els_shrdone_alpha_va"
```

If the `cluster_id` has never been seen before, the platform auto-creates a `Cluster` row with `status=unknown`. The cluster appears in the dashboard immediately. After the first analysis cycle (< 5 seconds), real verdicts replace the unknown status.

---

## Worker queue

- `asyncio.Queue(maxsize=500)` — back-pressure at 500 pending jobs
- 3 worker coroutines drain the queue concurrently (configurable via `push_worker_count`)
- Each worker calls `run_cluster_from_metrics()` — same intelligence pipeline as pull
- If the queue is full, the job is dropped and a warning is logged (the push sender already got 202)

Scale plan:

| Customers | Clusters | Workers | Queue backend |
|---|---|---|---|
| 1–5 | < 50 | 3 | asyncio.Queue (current) |
| 5–20 | 50–200 | 5–10 | asyncio.Queue |
| 20+ | 200+ | — | Redis Streams + Celery |

---

## Advantages over pull

| Capability | Pull | Push |
|---|---|---|
| Detection latency | 5 minutes | < 5 seconds |
| Works in air-gapped network | No | Yes |
| Customer gives us API credentials | Yes | No — token only |
| Works without Grafana | No | Yes |
| Customer controls sampling rate | No | Yes |
| No platform-side API quota | No | Yes |

---

## Files

| File | Role |
|---|---|
| `app/api/routes/ingest.py` | `POST /ingest/metrics` handler |
| `app/ingest/auth.py` | Bearer token validation, SHA-256 lookup |
| `app/ingest/normaliser.py` | DB-backed normalisation, TTL cache, unmapped recording |
| `app/ingest/derived.py` | DerivedRule definitions, `apply_derived_rules()` |
| `app/ingest/queue.py` | `AnalysisJob`, `enqueue()`, `worker_loop()` |
| `app/runner/analyzer_runner.py` | `run_cluster_from_metrics()` — shared intelligence pipeline |
| `app/main.py` | Starts 3 worker coroutines in FastAPI lifespan |
| `app/core/config.py` | `push_worker_count` setting |
| `scripts/issue_ingest_token.py` | Issue, list, revoke tokens |
| `scripts/simulate_push.py` | Test data generator — ES (4 nodes) + MySQL (2 nodes) |
