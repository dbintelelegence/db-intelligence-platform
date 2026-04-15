# DB Intelligence Platform — Master Plan v2.0
## April 2026

---

## 1. What this product is

A database oncall assistant. When something is wrong with a database, an engineer
logs in, looks at the dashboard, and immediately knows:

- **Which cluster or node** has a problem
- **What exactly is wrong** (not "high CPU" — "JVM heap exhausted, GC cannot reclaim
  memory, old-gen running every 12 seconds")
- **Why it is happening** (root cause, in plain English, backed by evidence)
- **What to do about it** (specific, ordered actions)

The platform reduces Mean Time To Resolution (MTTR) by replacing the guesswork
of "check Grafana → check Datadog → check logs → ask Slack" with a single screen
that already did all of that and explains the answer.

**We do not collect metrics. We read what the customer already has.**
**We do not alert. We explain.**
**We do not automate. We advise.**

---

## 2. The one principle that overrides everything else

**Deterministic analyzers find the truth. The LLM explains the truth.**

The LLM never diagnoses. Analyzers produce structured verdicts using sigma scores
and baseline comparison. The LLM converts them to plain English only when the
status changes. If the LLM is unavailable, the system still works — it falls back
to the structured verdict text.

---

## 3. Hard constraints — never violate these

| Constraint | Rule |
|---|---|
| Advisory-only | Never write code that modifies, restarts, or reconfigures a customer database |
| Read-only | Only GET/read calls on customer infrastructure. Never POST/PUT/DELETE |
| No LLM in analyzers | LLM belongs only in the verdict writer, triggered by status change |
| LLM on status change only | Always check `new_status != prev_status` before calling LLM |
| No raw metrics storage | Metric values held in memory only. Baselines and verdicts persisted |
| Append-only verdicts | Never UPDATE the verdicts table. Always INSERT a new row |
| Engine abstraction | Never hardcode Elasticsearch outside ES-specific modules |
| Tenant isolation | Every database query must include a `tenant_id` filter. No exceptions |
| No stack exposure | The Stack concept is internal only. Never appears in API or UI |

---

## 4. Architecture — three layers

```
┌──────────────────────────────────────────────────────┐
│  LAYER 1 — PRESENTATION                              │
│  React frontend + FastAPI REST API                   │
│  What the customer sees: cluster names, health,      │
│  issues, verdicts, AI explanations                   │
│  Never exposes: source type, stack, normalisation    │
├──────────────────────────────────────────────────────┤
│  LAYER 2 — INTELLIGENCE                              │
│  Baseline engine → Analyzers → Verdict writer        │
│  → LLM explanation                                   │
│  Engine-specific, source-agnostic                    │
│  Operates on canonical metric names only             │
├──────────────────────────────────────────────────────┤
│  LAYER 3 — INGESTION (internal only, never exposed)  │
│  Source adapters (pull) + Ingest endpoint (push)     │
│  Normalisation maps + Token auth                     │
│  Translates raw source metric names → canonical      │
└──────────────────────────────────────────────────────┘
```

Layer 1 never talks to Layer 3 directly. This boundary is sacred.

---

## 5. Intelligence pipeline

```
METRICS (required)     ──►  ANALYZERS  ──►  VERDICTS  ──►  LLM
LOG SIGNALS (optional) ──►             (always)       (status change)
METADATA (optional)    ──►
```

Metrics are the only hard requirement. Log signals and metadata are additive.
The verdict is always written. The LLM runs only when status changes.

---

## 6. Metric ingestion — two paths

### Pull path (current)
The backend adapter queries the customer's monitoring system on a schedule (every
5 minutes). Supports: Grafana Cloud (Prometheus API), Datadog.

```
Grafana Cloud / Datadog  ←── Adapter (scheduled pull, 5 min)
                                  │ canonical metrics in memory
                                  ▼
                          Baseline engine / Analyzers
```

### Push path (built, not fully exercised)
The customer configures their exporter to push to `POST /ingest/metrics`. The
platform receives raw metric names, normalises via the normalisation map, computes
derived metrics, then enqueues for analysis. Returns HTTP 202 immediately.

```
Prometheus / OTel / custom exporter
           │  POST /ingest/metrics (bearer token)
           ▼
    Normalise → derive → enqueue  ──►  Workers  ──►  Analyzers
```

Use push when: air-gapped environments, no monitoring platform, or Prometheus
remote_write is already configured.

---

## 7. Normalisation

Every source system names metrics differently. The same JVM heap usage metric
arrives as:
- `elasticsearch_jvm_memory_heap_used_percent` (Prometheus exporter)
- `elasticsearch.jvm.mem.heap_used_percent` (Datadog)
- `elastic_jvm_memory_heap_used_percent` (Elastic exporter)

The normalisation map (stored in the database, never hardcoded) translates all
variants to a single canonical name: `jvm.heap.used.percent`. Analyzers use only
canonical names.

The map is keyed by `(source_type, db_type, raw_metric_name)`. The product team
updates it through the internal admin UI without deployment. Changes take effect
within 5 minutes (TTL cache).

When a metric arrives that has no mapping, it is recorded in `unmapped_metrics`
with an occurrence count. The product team reviews this table to discover new
exporter variants.

Derived metrics (e.g., `jvm.heap.used.percent` = heap_used / heap_max * 100) are
computed in the ingestion layer before the analyzer runs.

---

## 8. Analyzer pattern

Every analyzer follows this exact structure:

```python
class SomeFailureModeAnalyzer(BaseAnalyzer):
    ANALYZER_NAME = "failure_mode_name"   # one failure mode, not one metric
    DB_TYPE       = "elasticsearch"

    PRIMARY_METRICS       = [...]  # missing = analyzer cannot run
    CORROBORATING_METRICS = [...]  # missing = confidence ceiling drops
    OPTIONAL_LOG_SIGNALS  = [...]  # missing = confidence ceiling lower

    def analyze(self, metrics, baselines, log_signals={}, metric_ts=None):
        # 1. Compute sigma scores against baselines
        # 2. Apply thresholds: healthy / degraded / critical
        # 3. Build evidence list
        # 4. Compute confidence
        # 5. Return VerdictResult — never call LLM here
```

Naming convention:
- Wrong: `CPU Analyzer`, `Heap Analyzer`, `Disk Analyzer`
- Right: `JVM Heap Exhaustion Analyzer`, `Disk Watermark Pressure Analyzer`

Each analyzer targets one failure mode, not one metric.

### Confidence scoring rules

| Condition | Effect |
|---|---|
| PRIMARY metrics missing | Analyzer does not run |
| CORROBORATING metrics missing | Confidence ceiling drops |
| All primary + corroborating present | MEDIUM base |
| Log signal corroborates | +1 level |
| Metadata confirms hypothesis | +1 level |
| No baseline yet (< 100 samples) | LOW regardless |
| Log signal contradicts | -1 level |
| Maximum | HIGH |
| Minimum | LOW |

---

## 9. Per-instance verdicts

Some failure modes are inherently per-node, not per-cluster. JVM heap pressure
is one: each Elasticsearch node has its own JVM and its own heap exhaustion state.
Collapsing these to a cluster average produces meaningless numbers.

For these analyzers, `analyze()` returns `list[VerdictResult]` where each item has
`instance_id` set. The runner iterates the list and writes one verdict row per node.
The dashboard subquery groups by `(cluster_id, analyzer_name, instance_id)`.
The UI labels issues as `"JVM heap pressure elevated — es-node-3"`.

- `instance_id = None` = cluster-level verdict (ES shard allocation, thread pool)
- `instance_id = "hostname"` = per-node verdict (ES JVM heap, MySQL InnoDB buffer pool)

---

## 10. What the customer sees

### Overview page
- Stat strip: total clusters, healthy, need attention, cost (clickable, each navigates)
- Stale data banner: shown when any cluster's last verdict is > 30 min old
- Open issues feed: ranked by severity (critical first), each shows cluster, node, severity chip
- Clusters needing attention: non-healthy clusters with issue count and verdict age
- Healthy fleet: collapsed by default, searchable

### Issue detail panel
Opens inline (no navigation) when an issue row is clicked. Shows:
- Issue title and severity
- Plain-English LLM explanation (one paragraph, no hedging, no bullet points)
- Root cause (determined by the analyzer)
- Recommendation (ordered actions)
- Related metrics (from evidence items)

### Databases page
Full list of clusters, filterable by `?status=healthy` or `?status=attention`.
Shows: cluster name, DB type, region, health status, active issue count.

### Database detail page
Per-cluster view showing:
- Live metrics (CPU, memory, storage, latency, throughput)
- All active verdicts for the cluster
- Verdict history
- AI chat panel (ad-hoc questions about the cluster, answered by the LLM using current verdict context)

---

## 11. Analyzer inventory

### Elasticsearch (5 built, 4 planned)

| # | Failure mode | File | Status |
|---|---|---|---|
| 1 | JVM heap exhaustion | `elasticsearch/jvm_heap_pressure.py` | Built, 21 tests |
| 2 | Shard allocation failure | `elasticsearch/shard_allocation.py` | Built |
| 3 | Thread pool saturation | `elasticsearch/thread_pool_saturation.py` | Built |
| 4 | Disk watermark pressure | `elasticsearch/disk_watermark.py` | Built, uncommitted |
| 5 | Fielddata circuit breaker | `elasticsearch/fielddata_circuit_breaker.py` | Built, uncommitted |
| 6 | Shard imbalance | `elasticsearch/shard_imbalance.py` | Not built |
| 7 | Search latency degradation | `elasticsearch/search_latency_degradation.py` | Not built |
| 8 | Indexing throughput collapse | `elasticsearch/indexing_throughput_collapse.py` | Not built |

### MySQL (4 built, 1 uncommitted)

| # | Failure mode | File | Status |
|---|---|---|---|
| 1 | Connection pool saturation | `mysql/connection_pool_saturation.py` | Built |
| 2 | Replication lag | `mysql/replication_lag.py` | Built |
| 3 | InnoDB buffer pool pressure | `mysql/innodb_buffer_pool_pressure.py` | Built, per-instance |
| 4 | Disk space exhaustion | `mysql/disk_space.py` | Built, uncommitted |

### Future engines (not yet started)
PostgreSQL, MongoDB, Redis, Cassandra, Couchbase

---

## 12. Data model

### Core tables

```
tenants              — one row per customer (isolation anchor)
stacks               — internal: one per (tenant, db_type, source_type)
clusters             — what the customer sees: cluster name + current status
ingest_tokens        — bearer tokens for push ingest (SHA-256 hash only)
normalisation_map    — source metric name → canonical name (product team maintains)
unmapped_metrics     — metrics that arrived but couldn't be mapped (feedback loop)
baseline_profiles    — statistical baselines per (cluster, metric, window_type)
verdicts             — append-only verdict history (never UPDATE)
verdict_evidence     — individual evidence items per verdict
llm_explanations     — LLM-generated explanations (one per verdict, on status change)
onboarding_sessions  — state machine for customer onboarding flow
cluster_metric_registry — which metrics are seen per cluster
analyzer_capability_map — can each analyzer run? at what confidence ceiling?
```

### Key design decisions

**Append-only verdicts:** The `verdicts` table is a history log. Every run inserts
a new row. The current verdict is always the latest row per `(cluster_id, analyzer_name,
instance_id)`. This enables full postmortem replay.

**Baseline windows:** Baselines are computed per window type (`all`, `weekday`,
`weekend`, `business_hours`, `off_hours`). A Thursday 3am heap spike compared
against a business-hours baseline is misleading. The analyzer picks the right window.

**Sigma scoring, not absolute thresholds:** Analyzers compare current values against
the cluster's own historical baseline using z-scores (sigma). A heap usage of 80%
may be normal for one cluster and critical for another. The system learns what
normal is for each cluster individually.

---

## 13. LLM usage — constraints and design

The LLM is called exactly once per status change per `(cluster, analyzer, instance)`.
It receives the structured verdict — not raw metrics. The prompt instructs it to:

- State what happened in plain English (one paragraph, no headers, no bullets)
- Explain why it matters for this specific cluster
- Confirm the recommended action
- Use technical database terminology freely
- Never hedge ("it appears", "may be", "could be")
- Never diagnose — the analyzer already determined the root cause

If the LLM fails (API down, timeout, missing key), the verdict is written anyway
and the `root_cause` field is used as the explanation. The LLM is never on the
critical path.

Model: Claude Haiku (fast, cheap, sufficient for structured narrative generation).
Max output: 300 tokens.

---

## 14. Source systems

### Currently supported
- **Grafana Cloud** (pull): Prometheus HTTP API, basic auth, PromQL queries

### Planned
- **Datadog** (pull): Datadog Metrics API, separate normalisation map
- **Amazon CloudWatch** (pull): AWS SDK, IAM auth
- **Prometheus remote_write** (push): The current push ingest endpoint already supports this — add a Prometheus protobuf decoder

### Auth model (push path)
Bearer tokens are issued per `(tenant, stack)`. Raw tokens are shown once at
issuance and never stored. Only the SHA-256 hash is persisted. Token issuance,
listing, and revocation via CLI script (`scripts/issue_ingest_token.py`).

---

## 15. Onboarding flow

When a customer connects a new database source:

```
Step 1 — Connect source
  Customer enters: source type, endpoint, API key
  Platform: tests connection → success or specific error message

Step 2 — Discovery
  Platform: scans for clusters, checks metrics against normalisation map
  Customer sees: list of clusters found with metric coverage per cluster
    ✓ prod-es-01   23 metrics recognised — Full analysis available
    ⚠ staging-es   18 metrics recognised — Reduced confidence
    ? es-archive    3 metrics recognised — Limited analysis

Step 3 — Cluster selection
  Customer picks which clusters to monitor

Step 4 — Baseline seeding
  Platform pulls 30 days of historical data, computes baseline profiles
  Customer sees: progress indicator
  Target: first verdict < 15 minutes from Step 1

Step 5 — First verdicts
  Customer sees real health status and issues
```

The `onboarding_sessions` table tracks state machine progress. Error messages
are customer-friendly ("We couldn't connect with that API key. Check that it has
read access to metrics and hasn't expired."), not technical error codes.

---

## 16. Build sequence

### Phase 1 — Elasticsearch prototype (complete)
| Step | Description | Status |
|---|---|---|
| 1 | Discovery — confirm real metric names from Grafana Cloud | Complete |
| 2 | Database schema and migrations | Complete |
| 3 | Grafana Cloud adapter | Complete |
| 4 | Baseline seeder | Complete |
| 5 | Analyzer runner + scheduler | Complete |
| 6 | Verdict writer + LLM explainer | Complete |
| 7 | Shard allocation analyzer | Complete |
| 8 | Thread pool saturation analyzer | Complete |
| 9 | Frontend: overview, databases, detail pages | Complete |

### Phase 2 — MySQL + multi-cluster (complete)
| Step | Description | Status |
|---|---|---|
| 2a | MySQL normalisation map | Complete |
| 2b | MySQL adapter (Grafana Cloud) | Complete |
| 2c | MySQL analyzers: connection pool, replication lag, InnoDB buffer pool | Complete |
| 2d | Per-instance verdict pattern | Complete |
| 2e | Push ingest architecture | Complete |
| 2f | Pull scheduler (DB-driven, no hardcoded cluster list) | Complete |

### Phase 3 — Hardening (current)
| Step | Description | Status |
|---|---|---|
| 3a | Disk watermark analyzer (ES) | Written, uncommitted |
| 3b | Fielddata circuit breaker analyzer (ES) | Written, uncommitted |
| 3c | Disk space analyzer (MySQL) | Written, uncommitted |
| 3d | Tests for 3a, 3b, 3c | Not written |
| 3e | Internal admin views — unmapped metrics UI | Not built |
| 3f | End-to-end integration test | Not built |

### Phase 4 — Expansion (next)
| Step | Description | Priority |
|---|---|---|
| 4a | ES: shard imbalance analyzer | High |
| 4b | ES: search latency degradation analyzer | High |
| 4c | ES: indexing throughput collapse analyzer | Medium |
| 4d | Datadog adapter | Medium |
| 4e | Onboarding wizard UI | Medium |
| 4f | Verdict evidence persistence (DB) | Low |
| 4g | Analyzer capability map population | Low |
| 4h | Notification on status change (email/Slack) | Future |
| 4i | PostgreSQL engine | Future |
| 4j | MongoDB engine | Future |
| 4k | Log signal ingestion | Future |
| 4l | Metadata enrichment stage | Future |
| 4m | Auth0 / SAML integration | Future |
| 4n | Postmortem report generation | Future |

---

## 17. What is deliberately out of scope

- **Not an alerting tool.** Use PagerDuty / Grafana alerts for that.
- **Not a metrics collector.** Grafana, Datadog, CloudWatch do that.
- **Not an automation tool.** We never modify a customer database.
- **Not a log aggregator.** Log signals are optional enrichment only.
- **Not a replacement for monitoring dashboards.** We sit above them.

---

## 18. File map — current state

### Backend
```
backend/app/
├── adapters/
│   └── grafana_cloud/adapter.py      — pull adapter, ES + MySQL PromQL
├── analyzers/
│   ├── base.py                        — VerdictResult, BaseAnalyzer
│   ├── elasticsearch/
│   │   ├── jvm_heap_pressure.py       — committed, 21 tests
│   │   ├── shard_allocation.py        — committed
│   │   ├── thread_pool_saturation.py  — committed
│   │   ├── disk_watermark.py          — uncommitted
│   │   └── fielddata_circuit_breaker.py — uncommitted
│   └── mysql/
│       ├── connection_pool_saturation.py — committed
│       ├── replication_lag.py          — committed
│       ├── innodb_buffer_pool_pressure.py — committed
│       └── disk_space.py              — uncommitted
├── baseline/
│   ├── engine.py                      — do not touch
│   └── seeder.py                      — --all-alpha-es/mysql/both flags
├── ingest/
│   ├── auth.py                        — bearer token validation
│   ├── normaliser.py                  — DB-backed, 5-min TTL cache
│   ├── derived.py                     — compute heap %, disk %, connection %
│   └── queue.py                       — asyncio.Queue(500), N workers
├── runner/
│   ├── analyzer_runner.py             — run_cluster_from_metrics(), run_all_active_clusters()
│   └── llm_explainer.py               — Claude Haiku, status change only
├── scheduler/
│   └── runner_scheduler.py            — 5-min pull loop
├── api/routes/
│   ├── dashboard.py                   — /dashboard/summary (tenant-scoped)
│   ├── ingest.py                      — POST /ingest/metrics (push path)
│   ├── clusters.py
│   ├── verdicts.py
│   ├── baselines.py
│   └── ai.py                          — /ai/chat proxy
└── models/models.py                   — all tables + migrations
```

### Frontend
```
src/
├── pages/
│   ├── OverviewPage.tsx               — stat strip, issue feed, cluster list
│   ├── DatabasesPage.tsx              — live data, ?status= filter
│   └── DatabaseDetailPage.tsx         — live metrics, verdicts, AI chat
├── hooks/
│   └── useDashboard.ts                — fetches /dashboard/summary
└── components/features/
    ├── database-detail/ClusterAIPanel.tsx
    └── summarization/ChatInterface.tsx
```

### Scripts
```
backend/scripts/
├── seed_normalisation.py              — ES normalisation map
├── seed_mysql_normalisation.py        — MySQL normalisation map + 4 clusters
├── seed_alpha_clusters.py             — 5 Alpha ES clusters
├── issue_ingest_token.py              — issue/list/revoke push tokens
└── simulate_push.py                   — test push endpoint with synthetic data
```

---

## 19. Live clusters (prototype)

### Elasticsearch (Alpha)
| Cluster | Status | Notes |
|---|---|---|
| els_shrdegt_alpha_va | good | No JVM metrics in Grafana |
| els_shrdone_alpha_va | good | All 3 analyzers healthy |
| els_shrdsix_alpha_va | good | All 3 analyzers healthy |
| els_shrdsvn_alpha_va | warning | JVM heap pressure p50=62.97% |
| els_sixna_alpha_va | warning | JVM heap pressure p50=61.6% |

### MySQL (Alpha)
| Cluster | Notes |
|---|---|
| mysql_aa_alpha | Per-instance InnoDB verdicts |
| mysql_bigaa_alpha | Per-instance InnoDB verdicts |
| mysql_mng_alpha | Per-instance InnoDB verdicts |
| mysql_sharedaa_alpha | Per-instance InnoDB verdicts |

---

## 20. Do not touch these files

```
backend/app/analyzers/elasticsearch/jvm_heap_pressure.py  — tested, correct
backend/app/baseline/engine.py                             — tested, correct
backend/app/schemas/schemas.py                             — tested, correct
backend/app/analyzers/base.py                              — requires explicit instruction
```

Changes to these require explicit instruction from the user. Do not modify as part
of routine work.
