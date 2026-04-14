# Grafana Cloud Discovery Notes

Discovery run: 2026-04-13 (manual)
Cluster under test: els_shrdone_alpha_va (Alpha environment)

---

## Connection

| Field | Value |
|---|---|
| Prometheus URL | https://prometheus-us-central1.grafana.net/api/prom |
| Instance ID | 908263 |
| Auth method | Basic auth — `instance_id:api_key` |
| Stack name | GCP PROD DB |

---

## Label hierarchy — CRITICAL

The plan assumed a single `cluster` label. Reality is a four-level hierarchy:

| Label | Example values | Meaning |
|---|---|---|
| `lp_role` | `ElasticSearch`, `opensearch`, `mysql` | Engine type |
| `lp_segment` | `Alpha`, `Prod` | Environment |
| `datacenter` | `GCP-Alpha`, `GCP-US-PROD` | Region |
| `lp_cluster` | `els_shrdone_alpha_va` | Cluster name |
| `instance` | node hostname | Individual node |

**Unique cluster identity = `lp_segment` + `datacenter` + `lp_cluster`**

`lp_cluster` alone is NOT unique — the same name can appear in multiple segments.
The adapter must use the composite key.

---

## Exporter

`prometheus-community/elasticsearch_exporter`
Prefix: `elasticsearch_` — clean standard names, no exotic variants found.

---

## Clusters found

### Alpha (5 clusters)
- els_shrdegt_alpha_va
- els_shrdone_alpha_va  ← prototype target
- els_shrdsix_alpha_va
- els_shrdsvn_alpha_va
- els_sixna_alpha_va

### Prod (14 clusters)
- elast_chat_prod
- els_aiwb_prod
- els_audit_prod
- els_chat_prod
- els_intnt_prod
- els_kai_prod
- els_kf2es_prod
- els_main_prod
- els_mia2_gis_lmsthd_tmo_vz_prod
- els_mia3_anthem_prod
- els_mia_prod
- els_reprt_prod
- els_shrd7_prod
- els_voice8_prod

### Datacenters
GCP-APAC-PROD, GCP-Alpha, GCP-EMEA-PROD, GCP-US-PROD, australia-southeast1, europe-west1, us-east1

### Other lp_role values in the fleet (not Phase 1 targets)
opensearch, mysql, mongodb, couchbase, cassandra, redis, vertica, kafka, kafka_zookeeper, zookeeper, metadefender

Note: `opensearch` is present alongside `ElasticSearch`. They are different engines.
The adapter must filter strictly on `lp_role="ElasticSearch"`.

---

## Metric names confirmed (els_shrdone_alpha_va)

### JVM Heap Pressure analyzer

| Canonical name | Source metric name | Notes |
|---|---|---|
| `jvm.heap.used.bytes` | `elasticsearch_jvm_memory_used_bytes` | filter: `area="heap"` |
| `jvm.heap.max.bytes` | `elasticsearch_jvm_memory_max_bytes` | filter: `area="heap"` |
| `gc.old.collection.seconds` | `elasticsearch_jvm_gc_collection_seconds_sum` | filter: `gc="old"` — label is `gc`, not `collector` |
| `gc.old.collection.count` | `elasticsearch_jvm_gc_collection_seconds_count` | filter: `gc="old"` — label is `gc`, not `collector` |

**CRITICAL — derived metric:**
`jvm.heap.used.percent` is NOT directly available as a metric.
It must be computed by the adapter:

```
jvm.heap.used.percent =
    elasticsearch_jvm_memory_used_bytes{area="heap"} /
    elasticsearch_jvm_memory_max_bytes{area="heap"} * 100
```

The normalisation layer needs a derived metric concept — not just 1:1 name mapping.

### Shard Allocation analyzer

| Canonical name | Source metric name | Notes |
|---|---|---|
| `cluster.shards.unassigned` | `elasticsearch_cluster_health_unassigned_shards` | confirmed |
| `cluster.health.status` | `elasticsearch_cluster_health_status` | confirmed |
| `cluster.shards.relocating` | `elasticsearch_cluster_health_relocating_shards` | confirmed |
| `cluster.shards.initializing` | `elasticsearch_cluster_health_initializing_shards` | confirmed |
| `cluster.shards.active` | `elasticsearch_cluster_health_active_shards` | confirmed |

### Thread Pool analyzer

| Canonical name | Source metric name | Notes |
|---|---|---|
| `thread_pool.write.rejected` | `elasticsearch_thread_pool_rejected_count` | filter: `type="bulk"` — no `write` type; cluster is pre-ES6; use `bulk` for write workload |
| `thread_pool.write.queue` | `elasticsearch_thread_pool_queue_count` | filter: `type="bulk"` |
| `thread_pool.write.active` | `elasticsearch_thread_pool_active_count` | filter: `type="bulk"` |

**All thread pool type values present:** bulk, fetch_shard_started, fetch_shard_store, flush, generic, get, index, listener, management, merge, optimize, percolate, refresh, search, snapshot, suggest, warmer

### Additional metrics (future analyzers)

| Source metric name | Intended canonical | Phase |
|---|---|---|
| `elasticsearch_indices_fielddata_evictions` | fielddata eviction signal | 2 |
| `elasticsearch_indices_fielddata_memory_size_bytes` | fielddata cache size | 2 |
| `elasticsearch_indices_search_query_time_seconds` | search latency | 2 |
| `elasticsearch_indices_search_query_total` | search throughput | 2 |
| `elasticsearch_indices_indexing_index_total` | indexing throughput | 3 |
| `elasticsearch_breakers_tripped` | circuit breaker trips | 2 |
| `node_filesystem_avail_bytes` | disk available | 2 |
| `node_filesystem_size_bytes` | disk total | 2 |
| `node_cpu_seconds_total` | CPU usage | 2 |

---

## Blockers — RESOLVED

| # | Blocker | Resolution |
|---|---|---|
| 1 | GC collector label name | Label is `gc`, not `collector`. Value for old-gen is `"old"`. Filter: `gc="old"` |
| 2 | Thread pool type label values | No `write` type exists. Cluster is pre-ES6. Write workload = `type="bulk"`. All types: bulk, fetch_shard_started, fetch_shard_store, flush, generic, get, index, listener, management, merge, optimize, percolate, refresh, search, snapshot, suggest, warmer |

All blockers cleared. Step 3 (adapter) can proceed.

---

## 30-day data volume

Not yet measured. Measure before baseline seeder (Step 4):

```bash
curl -u "$INSTANCE_ID:$GRAFANA_API_KEY" \
  "$GRAFANA_URL/api/v1/query_range" \
  --data-urlencode 'query=elasticsearch_jvm_memory_used_bytes{lp_cluster="els_shrdone_alpha_va",area="heap"}' \
  --data-urlencode "start=$(date -v-30d +%s)" \
  --data-urlencode "end=$(date +%s)" \
  --data-urlencode "step=60s" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); r=d['data']['result']; print(f'Series: {len(r)}, Points: {len(r[0][\"values\"]) if r else 0}')"
```

Expected: ~43,200 points per series (30 days × 1440 min/day at 60s step).
