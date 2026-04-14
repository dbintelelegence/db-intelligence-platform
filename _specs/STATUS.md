# DB Intelligence Platform — Session Status

> Claude Code: Read this file BEFORE reading the plan document.
> Update this file WHENEVER a step completes, something is discovered,
> or a session ends for any reason.

---

## Current status

**Phase:** Frontend Polish + Multi-Cluster Expansion
**Plan document:** `_specs/plan-master.md`
**Last updated:** April 14 2026 — UI fixes, multi-cluster, and navigation improvements
**Last session ended:** All 5 Alpha ES clusters live; overview page and detail page navigation fixed

---

## Build sequence progress

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| 1 | Discovery — Grafana Cloud queries | Complete | Done manually, findings below |
| 2 | Database schema and migrations | Complete | All tables created, normalisation map seeded, 21/21 tests pass |
| 3 | Adapter interface and configuration | Complete | GrafanaCloudAdapter live-tested, all 9 Phase 1 metrics returning real values |
| 4 | Baseline seeder | Complete | backend/app/baseline/seeder.py — 2d/5min/sequential, --all-alpha flag added |
| 5 | Analyzer runner | Complete | backend/app/runner/analyzer_runner.py — live verdict written, status change detection works, --all-alpha flag added |
| 6 | Verdict writer | Complete | backend/app/runner/llm_explainer.py — LLM called on status change, stored in llm_explanations |
| 7 | Shard allocation failure analyzer | Complete | backend/app/analyzers/elasticsearch/shard_allocation.py — live, green/0 unassigned |
| 8 | Thread pool saturation analyzer | Complete | backend/app/analyzers/elasticsearch/thread_pool_saturation.py — live, 0 rejections/queue |
| 9 | Frontend API client | Complete | /dashboard/summary endpoint + useDashboard hook — all metrics live |
| 10 | Internal admin views | Not started | |
| 11 | End-to-end integration test | Not started | |

---

## Multi-cluster expansion (complete)

All 5 Alpha Elasticsearch clusters seeded, baselined, and analyzed:

| Cluster | Status | Notes |
|---------|--------|-------|
| els_shrdegt_alpha_va | good | No JVM metrics in Grafana for this cluster |
| els_shrdone_alpha_va | good | All 3 analyzers healthy |
| els_shrdsix_alpha_va | good | All 3 analyzers healthy |
| els_shrdsvn_alpha_va | warning | JVM heap pressure above baseline (p50=62.97%) |
| els_sixna_alpha_va | warning | JVM heap pressure above baseline (p50=61.6%) |

Scripts:
- `backend/scripts/seed_alpha_clusters.py` — inserts 4 additional clusters into DB
- `backend/app/baseline/seeder.py --all-alpha` — seeds baselines for all 5
- `backend/app/runner/analyzer_runner.py --all-alpha` — runs all analyzers for all 5

---

## Frontend changes (this session)

### Bug fixes
- **Mock data flash on overview page** — `useDashboard` now returns empty arrays during load instead of mock data; overview shows skeleton while loading
- **"Database not found" flash on detail page** — detail page now shows spinner while `loading=true` instead of immediately rendering "not found"
- **Healthy cluster section showed all clusters** — `filteredClusters` was using `databases` (all) instead of `healthy` when `showHealthy=true`
- **Cluster IDs with `|` pipes broke URL routing** — `dashboard.py` now returns UUID as `id` (was returning `cluster_id` composite string); `databaseId` in issues also uses UUID

### New features
- **Stat strip navigation** — Total/Healthy/Need attention/Monthly cost numbers are now clickable buttons routing to `/databases`, `/databases?status=healthy`, `/databases?status=attention`, `/billing`
- **DatabasesPage uses live data** — replaced `mockData` + `useScoredDatabases` with `useDashboard` hook
- **Status filter on DatabasesPage** — `?status=healthy` or `?status=attention` query params filter cluster list; filter chip shown with × to clear

---

## Next action

Step 10 — Internal admin views (unmapped metrics). Build a simple admin page
or API endpoint that shows what metrics arrived but couldn't be mapped
(unmapped_metrics table), so the product team can update the normalisation map.

---

## Step 1 — Discovery COMPLETE

**Output file:** `backend/app/adapters/grafana_cloud/DISCOVERY_NOTES.md` ✓ exists
**Completion criteria met:** DISCOVERY_NOTES.md exists with real data, all confirmed metrics
documented, cluster label hierarchy documented, blockers recorded.

---

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

## Known gaps — deferred decisions

| Gap | Decision | When to revisit |
|-----|----------|-----------------|
| Historical metric storage | Not stored locally. Historical queries re-fetch from Grafana Cloud on demand via adapter `get_metrics()`. Grafana Cloud retains 13 months. Gap: if Grafana is unavailable or customer churns, history is lost. | When UI needs historical charts or when Grafana availability becomes a concern |
| Thread pool canonical name | `thread_pool.write.*` is the canonical name but this cluster uses `type="bulk"` (pre-ES6). Adapter encodes the filter; analyzers use canonical names only. | When adding ES6+ clusters — may need a second normalisation entry pointing `type="write"` to the same canonical |

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

| Blocker | Step | Resolution |
|---------|------|------------|
| GC collector label | Step 3 | RESOLVED — label is `gc` (not `collector`), value is `"old"` for old-gen |
| Thread pool type label | Step 3 | RESOLVED — no `write` type; cluster is pre-ES6; write workload = `type="bulk"` |

---

## Step 2 — Schema COMPLETE

**Migration:** 16320476fb3d_add_tenants_stacks_normalisation_unmapped_onboarding
**Tables created:** tenants, stacks, normalisation_map, unmapped_metrics, onboarding_sessions + all prior tables
**Seed:** 1 tenant (prototype), 1 stack (GCP Prod DB — Elasticsearch), 1 cluster (els_shrdone_alpha_va / Alpha), 21 normalisation_map entries
**Also:** config.py updated with Grafana Cloud env var fields; venv rebuilt with Python 3.11

---

## Test suite status

  backend/tests/test_analyzers/test_jvm_heap_pressure.py    21/21 ✓
  backend/tests/test_analyzers/test_shard_allocation.py     not built
  backend/tests/test_analyzers/test_thread_pool.py          not built
  backend/tests/test_adapters/test_grafana_cloud.py         not built
  backend/tests/test_runner/test_verdict_writer.py          not built
