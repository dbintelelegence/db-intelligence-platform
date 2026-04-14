# DB Intelligence Platform — Session Status

> Claude Code: Read this file BEFORE reading the plan document.
> Update this file WHENEVER a step completes, something is discovered,
> or a session ends for any reason.

---

## Current status

**Phase:** Grafana Cloud Pull Adapter + End-to-End Verdict Pipeline
**Plan document:** `_specs/plan-master.md`
**Last updated:** April 13 2026 — manual discovery session complete
**Last session ended:** Manual discovery done, ready for Step 2

---

## Build sequence progress

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| 1 | Discovery — Grafana Cloud queries | Complete | Done manually, findings below |
| 2 | Database schema and migrations | Not started | |
| 3 | Adapter interface and configuration | Not started | |
| 4 | Baseline seeder | Not started | |
| 5 | Analyzer runner | Not started | |
| 6 | Verdict writer | Not started | |
| 7 | Shard allocation failure analyzer | Not started | |
| 8 | Thread pool saturation analyzer | Not started | |
| 9 | Frontend API client | Not started | |
| 10 | Internal admin views | Not started | |
| 11 | End-to-end integration test | Not started | |

---

## Next action

Step 2 — Schema. Read backend/app/models/models.py and compare
to plan-master.md Section 11. Show a diff of what needs to change
and what new tables need to be added. Do not write any files until
the diff is reviewed and approved.

Before writing the adapter (Step 3), resolve the two blockers listed
at the bottom of this file.

---

## Step 1 — Discovery COMPLETE

### Grafana Cloud connection
- URL: https://prometheus-us-central1.grafana.net/api/prom
- Instance ID: 908263
- Stack: GCP PROD DB
- Auth: Basic auth with instance_id:api_key

### Label hierarchy — CRITICAL, updates required to plan-master.md
The plan assumed a single cluster label. Reality is a hierarchy:

  lp_role      = "ElasticSearch"              engine type
  lp_segment   = "Alpha" | "Prod"             environment
  datacenter   = "GCP-Alpha" | "GCP-US-PROD"  region
  lp_cluster   = "els_shrdone_alpha_va" etc   cluster name
  instance     = individual node hostname

Unique cluster identity = lp_segment + datacenter + lp_cluster
NOT just lp_cluster alone — same name can exist in multiple segments.

### All database roles in fleet (lp_role values)
ElasticSearch, opensearch, mysql, mongodb, couchbase, cassandra,
redis, vertica, kafka, kafka_zookeeper, zookeeper, metadefender

Note: Both ElasticSearch AND opensearch are present in the fleet.
OpenSearch is AWS fork — similar metrics, may have naming differences.
Phase 1 targets ElasticSearch only.

### Environments found
Alpha, Prod

### Elasticsearch clusters (19 total)

Alpha (5):
  els_shrdegt_alpha_va
  els_shrdone_alpha_va
  els_shrdsix_alpha_va
  els_shrdsvn_alpha_va
  els_sixna_alpha_va

Prod (14):
  elast_chat_prod, els_aiwb_prod, els_audit_prod, els_chat_prod,
  els_intnt_prod, els_kai_prod, els_kf2es_prod, els_main_prod,
  els_mia2_gis_lmsthd_tmo_vz_prod, els_mia3_anthem_prod,
  els_mia_prod, els_reprt_prod, els_shrd7_prod, els_voice8_prod

### Datacenters
GCP-APAC-PROD, GCP-Alpha, GCP-EMEA-PROD, GCP-US-PROD,
australia-southeast1, europe-west1, us-east1

### Exporter confirmed
prometheus-community/elasticsearch_exporter
Prefix: elasticsearch_ — clean standard names, no exotic variants

### Prototype scope
Start with ONE cluster: els_shrdone_alpha_va (Alpha environment)
Validate all analyzers against this cluster before expanding.

---

## Metric normalisation map (confirmed from els_shrdone_alpha_va)

### JVM Heap Pressure analyzer
CRITICAL: jvm.heap.used.percent is a DERIVED metric — not directly
available. Must compute:
  elasticsearch_jvm_memory_used_bytes{area="heap"} /
  elasticsearch_jvm_memory_max_bytes{area="heap"} * 100

Direct metrics:
  elasticsearch_jvm_memory_used_bytes       → jvm.heap.used.bytes
  elasticsearch_jvm_memory_max_bytes        → jvm.heap.max.bytes
  elasticsearch_jvm_gc_collection_seconds_sum   → gc.old.collection.seconds
  elasticsearch_jvm_gc_collection_seconds_count → gc.old.collection.count

Note: GC metrics have a collector label (old/young) — must filter
by collector="old" for old-gen analysis. UNVERIFIED — see blockers.

### Shard Allocation analyzer
  elasticsearch_cluster_health_unassigned_shards   → cluster.shards.unassigned
  elasticsearch_cluster_health_status              → cluster.health.status
  elasticsearch_cluster_health_relocating_shards   → cluster.shards.relocating
  elasticsearch_cluster_health_initializing_shards → cluster.shards.initializing
  elasticsearch_cluster_health_active_shards       → cluster.shards.active

### Thread Pool analyzer
  elasticsearch_thread_pool_rejected_count → thread_pool.write.rejected
  elasticsearch_thread_pool_queue_count    → thread_pool.write.queue
  elasticsearch_thread_pool_active_count   → thread_pool.write.active

Note: thread_pool metrics have a type label — must filter by
type="write" and type="search". UNVERIFIED — see blockers.

### Additional metrics for future analyzers
  elasticsearch_indices_fielddata_evictions        → fielddata eviction signal
  elasticsearch_indices_fielddata_memory_size_bytes → fielddata cache size
  elasticsearch_indices_search_query_time_seconds  → search latency
  elasticsearch_indices_search_query_total         → search throughput
  elasticsearch_indices_indexing_index_total       → indexing throughput
  elasticsearch_breakers_tripped                   → circuit breaker trips
  node_filesystem_avail_bytes                      → disk available
  node_filesystem_size_bytes                       → disk total
  node_cpu_seconds_total                           → CPU usage

---

## Discoveries and deviations from plan

1. Cluster identity is a composite key (lp_segment + datacenter +
   lp_cluster), not a single label. The stacks table and adapter
   must reflect this.

2. jvm.heap.used.percent is a derived metric requiring computation
   from two source metrics. The normalisation layer needs a derived
   metric concept — not just 1:1 name mapping.

3. thread_pool and gc metrics have sub-type labels (type="write",
   collector="old") that must be included in PromQL queries.
   The adapter cannot fetch by metric name alone.

4. Both ElasticSearch and opensearch roles exist in the fleet.
   The adapter must not assume these are the same engine.

5. node_exporter metrics are co-located with ES metrics under the
   same lp_role label. Useful for disk and CPU analyzers later.

---

## Blockers

| Blocker | Step | What is needed |
|---------|------|----------------|
| GC collector label values unverified | Step 3 | curl match[]={lp_cluster="els_shrdone_alpha_va",__name__="elasticsearch_jvm_gc_collection_seconds_count"} — confirm collector label values |
| Thread pool type label values unverified | Step 3 | curl match[]={lp_cluster="els_shrdone_alpha_va",__name__="elasticsearch_thread_pool_rejected_count"} — confirm type label values |

---

## Test suite status

  backend/tests/test_analyzers/test_jvm_heap_pressure.py    21/21 ✓
  backend/tests/test_analyzers/test_shard_allocation.py     not built
  backend/tests/test_analyzers/test_thread_pool.py          not built
  backend/tests/test_adapters/test_grafana_cloud.py         not built
  backend/tests/test_runner/test_verdict_writer.py          not built
