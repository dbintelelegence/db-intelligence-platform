# DB Intelligence Platform — Build Plan
## Phase: Grafana Cloud Pull Adapter + End-to-End Verdict Pipeline

**Document type:** Claude Code planning document  
**Consumed by:** Claude Code in plan mode  
**Last updated:** April 2026  
**Phase goal:** Replace all mock data with real verdicts from real Elasticsearch clusters via Grafana Cloud API

---

## 0. How to use this document

This document is the authoritative plan for this build phase. Claude Code should:

1. Read this entire document before writing any code
2. Follow the build sequence in Section 6 exactly — do not reorder steps
3. Check every decision against the constraints in Section 2 before implementing
4. Run the discovery steps in Section 4 before writing the normalisation map
5. Mark each component done only when its acceptance criteria in Section 7 pass

If something in this document conflicts with code that already exists, flag the conflict and ask before resolving it.

---

## 1. What this system is

A database optimization and health intelligence platform. It produces evidence-backed, design-aware verdicts about why Elasticsearch clusters behave poorly and what to do about it.

**The one-line principle:** Deterministic analyzers find the truth. The LLM explains the truth.

**What already exists in the codebase:**
- FastAPI backend skeleton with routes for ingestion, clusters, verdicts, baselines
- PostgreSQL schema — all 12 tables defined in `backend/app/models/models.py`
- Baseline engine — percentile computation in `backend/app/baseline/engine.py`
- `jvm_heap_pressure` analyzer — built and tested, 21/21 tests passing
- Canonical metric schema and normalisation map skeleton in `backend/app/api/routes/ingest.py`
- React frontend — overview page, cluster detail page, Cmd+K search, cluster AI panel
- Docker Compose for local full-stack development

**What does not exist yet (this phase builds it):**
- Grafana Cloud pull adapter — nothing built
- Analyzer runner — nothing built
- Verdict writer — nothing built
- Frontend API client — frontend still uses mock data

---

## 2. Constraints — never violate these

These are hard constraints. No implementation decision may contradict them.

| Constraint | What it means in code |
|------------|----------------------|
| Advisory-first | No code that modifies, restarts, or configures the customer's database |
| Read-only ingestion | The Grafana Cloud adapter only calls GET endpoints — never POST/PUT/DELETE |
| Deterministic analyzers find the truth | No LLM calls inside any analyzer. LLM only in verdict writer on status change. |
| LLM on status change only | Verdict writer checks `new_status != prev_status` before calling LLM |
| No raw metrics storage | Metric values are held in memory during a run cycle, fed to the baseline engine, then discarded. Only baselines and verdicts are persisted. |
| No raw log storage | Out of scope for this phase — log signals come later |
| Append-only verdicts | Never UPDATE the verdicts table. Always INSERT a new row. |
| Multi-DB abstraction | All adapter code must be behind an interface. Never hardcode Elasticsearch-specific logic outside the ES adapter module. |

---

## 3. Current data flow — target state for this phase

```
Grafana Cloud (Prometheus-compatible API)
        │
        │  GET /api/v1/query_range (PromQL)
        │  Auth: Bearer <grafana_api_key>
        ▼
GrafanaCloudAdapter
        │  Normalises metric names to canonical schema
        │  Returns list[CanonicalMetric]
        ▼
BaselineEngine
        │  Computes p50/p75/p95/p99/mean/std_dev per metric per window type
        │  Stores in baseline_profiles table
        ▼
AnalyzerRunner
        │  Checks capability_map — which analyzers can run on this cluster?
        │  Runs each capable analyzer
        │  Returns list[VerdictResult]
        ▼
VerdictWriter
        │  Detects status change vs previous verdict
        │  Writes to verdicts + verdict_evidence tables
        │  Triggers LLM explanation on status change
        │  Updates clusters.current_status
        ▼
REST API (existing FastAPI routes)
        │
        ▼
React Frontend (swap mock-data.ts for real API calls)
```

---

## 4. Discovery steps — run these before writing the normalisation map

Before building the normalisation map, the adapter must discover what metric names actually exist in this Grafana Cloud instance. Do not guess or assume metric names match the canonical list.

### 4.1 List all Elasticsearch-related metric names

```
GET <prometheus_base_url>/api/v1/label/__name__/values
Headers:
  Authorization: Bearer <grafana_api_key>
```

Filter the response for names containing `elasticsearch` or `es_`. Record every metric name found.

### 4.2 Inspect labels on a sample metric

Pick one metric (e.g. the first heap-related metric found). Run:

```
GET <prometheus_base_url>/api/v1/series
  ?match[]={__name__="<metric_name>"}
  &start=<now-1h>
  &end=<now>
Headers:
  Authorization: Bearer <grafana_api_key>
```

Record every label key present. This tells us which label contains the cluster identifier. Look for: `cluster`, `job`, `instance`, `exported_cluster`, `es_cluster`.

### 4.3 Verify data volume

For one metric on one cluster, query 30 days of data:

```
GET <prometheus_base_url>/api/v1/query_range
  ?query=<metric_name>{cluster="<cluster_label_value>"}
  &start=<now-30d>
  &end=<now>
  &step=60s
Headers:
  Authorization: Bearer <grafana_api_key>
```

Check how many data points are returned and that the response is well-formed. This validates that 30-day baseline seeding is feasible.

### 4.4 Record findings before proceeding

After running the discovery queries, create a file:

```
backend/app/adapters/grafana_cloud/DISCOVERY_NOTES.md
```

Document:
- The actual metric names found for each canonical metric we need
- Which label key contains the cluster identifier
- The approximate data point count for 30 days at 60s resolution
- Any metric names that were NOT found (capability gaps)

This file becomes the basis for the normalisation map. Do not write the normalisation map until this file exists.

---

## 5. Architecture decisions for this phase

### 5.1 Adapter interface

All metric source adapters must implement the same interface. This phase builds the Grafana Cloud adapter. The Prometheus remote_write adapter comes later. Both must be interchangeable from the analyzer runner's perspective.

```python
# backend/app/adapters/base.py
class BaseMetricsAdapter(ABC):
    
    @abstractmethod
    async def get_clusters(self) -> list[str]:
        """Return all cluster identifiers this adapter can see."""
        
    @abstractmethod  
    async def get_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
        start: datetime,
        end: datetime,
        step_seconds: int = 60,
    ) -> list[CanonicalMetric]:
        """
        Fetch metric values for a cluster over a time range.
        Returns CanonicalMetric objects — never raw source values.
        """
        
    @abstractmethod
    async def get_latest_metrics(
        self,
        cluster_id: str,
        canonical_names: list[str],
    ) -> dict[str, float]:
        """
        Fetch the most recent value for each metric.
        Used by the analyzer runner for current-state analysis.
        Returns dict: canonical_name -> value
        """
```

### 5.2 Grafana Cloud adapter location

```
backend/app/adapters/
    base.py                        ← abstract interface (above)
    grafana_cloud/
        __init__.py
        adapter.py                 ← GrafanaCloudAdapter implements BaseMetricsAdapter
        normalisation.py           ← metric name → canonical name mapping
        DISCOVERY_NOTES.md         ← filled in during discovery step 4
    prometheus/
        __init__.py
        adapter.py                 ← PrometheusRemoteWriteAdapter (future phase)
```

### 5.3 Configuration

New environment variables needed in `backend/.env`:

```
# Grafana Cloud
GRAFANA_CLOUD_PROMETHEUS_URL=https://prometheus-prod-XX.grafana.net/api/prom
GRAFANA_CLOUD_API_KEY=glc_xxxxxxxxxxxx
GRAFANA_CLOUD_CLUSTER_LABEL=cluster   # label key that identifies the ES cluster

# Analyzer runner
ANALYZER_RUN_INTERVAL_SECONDS=300     # how often to run analyzers (5 min default)
BASELINE_LOOKBACK_DAYS=30             # how many days to use for baseline seeding
BASELINE_MIN_SAMPLES=100              # minimum samples before baseline is valid
```

Add these to `backend/app/core/config.py` under the `Settings` class.

### 5.4 Analyzer runner design

The analyzer runner is a background task that:
1. Lists all registered clusters
2. For each cluster, fetches the capability map
3. For each runnable analyzer on that cluster, fetches required metrics (latest values) and baselines
4. Runs the analyzer
5. Passes the VerdictResult to the verdict writer

It runs on a configurable interval (default 5 minutes). For this phase it runs as a FastAPI background task on startup — not a separate worker process. A separate worker (Celery, ARQ, etc.) is a future phase concern.

### 5.5 Verdict writer design

The verdict writer:
1. Receives a `VerdictResult` from an analyzer
2. Queries the most recent verdict for this `cluster_id` + `analyzer_name` pair
3. Compares `new_status` to `prev_status`
4. Always writes a new row to `verdicts` (append-only — no update ever)
5. Writes each evidence item to `verdict_evidence`
6. If status changed: calls Anthropic API, stores result in `llm_explanations`
7. Updates `clusters.current_status` to worst status across all analyzers

### 5.6 Baseline seeding on first run

When a cluster is first seen by the adapter:
1. Pull 30 days of historical data for all required metrics
2. Feed into baseline engine
3. Compute and store baseline profiles
4. This makes high-confidence verdicts possible from the first analyzer run

On subsequent runs, only the latest metric values are fetched for the analyzer. Baseline recomputation happens nightly (not on every run).

### 5.7 Frontend API client

Replace `src/data/mock-data.ts` usage with real API calls. The existing FastAPI routes already exist:

- `GET /clusters/` → list all clusters
- `GET /clusters/{cluster_id}` → single cluster
- `GET /verdicts/cluster/{cluster_id}` → verdicts for a cluster
- `GET /baselines/cluster/{cluster_id}` → baselines for a cluster

Create `src/services/api.ts` as the single API client module. All components that currently import from `mock-data.ts` should be updated to use this client.

---

## 6. Build sequence — follow this order exactly

### Step 1 — Run discovery (no code yet)

Run the discovery queries in Section 4 against the real Grafana Cloud instance. Fill in `DISCOVERY_NOTES.md`. Do not write any adapter code until this is done.

**Done when:** `DISCOVERY_NOTES.md` exists with real metric names and the cluster label key identified.

---

### Step 2 — Adapter interface and configuration

Files to create:
- `backend/app/adapters/__init__.py`
- `backend/app/adapters/base.py` — abstract interface from Section 5.1
- `backend/app/adapters/grafana_cloud/__init__.py`
- Update `backend/app/core/config.py` — add Grafana Cloud + runner settings

**Done when:** `BaseMetricsAdapter` is importable and config loads without error.

---

### Step 3 — Grafana Cloud normalisation map

File to create:
- `backend/app/adapters/grafana_cloud/normalisation.py`

This file contains:
- `METRIC_MAP: dict[str, dict]` — maps source metric name to `{canonical, category, unit}`
- `CLUSTER_LABEL_KEY: str` — the label key that identifies the cluster
- `get_canonical_name(source_name: str) -> dict | None` — lookup function

The metric names in this map must come from `DISCOVERY_NOTES.md` — not guessed.

Minimum required mappings for Phase 1 analyzers (jvm_heap_pressure):
- `jvm.heap.used.percent` ← whatever the actual source metric name is
- `gc.old.collection.seconds` ← actual source name
- `gc.old.collection.count` ← actual source name

**Done when:** Every metric required by the three Phase 1 analyzers has a normalisation entry.

---

### Step 4 — GrafanaCloudAdapter implementation

File to create:
- `backend/app/adapters/grafana_cloud/adapter.py`

Implement `GrafanaCloudAdapter(BaseMetricsAdapter)` with:

`get_clusters()`:
- Queries Grafana Cloud for all unique values of the cluster label key
- Returns list of cluster identifier strings
- Filters to only clusters that have Elasticsearch metrics

`get_metrics(cluster_id, canonical_names, start, end, step_seconds)`:
- For each canonical name, looks up the source metric name from the normalisation map
- Builds PromQL query: `{__name__="<source_name>", <cluster_label>="<cluster_id>"}`
- Calls `GET /api/v1/query_range`
- Parses response and returns `list[CanonicalMetric]`
- Handles rate limiting with exponential backoff
- Raises clear error if a required metric is not found

`get_latest_metrics(cluster_id, canonical_names)`:
- Same as above but uses `GET /api/v1/query` (instant query, no range)
- Returns `dict[canonical_name -> float]` of most recent values

Error handling:
- HTTP 401 → raise `AdapterAuthError` with message "Check GRAFANA_CLOUD_API_KEY"
- HTTP 429 → retry with exponential backoff, max 3 retries
- HTTP 404 → raise `AdapterMetricNotFoundError` with the metric name
- Network timeout → raise `AdapterConnectionError`

**Done when:** Unit tests pass for `get_clusters()`, `get_metrics()`, and `get_latest_metrics()` using recorded Grafana Cloud responses (VCR cassettes or mocked HTTP responses).

---

### Step 5 — Baseline seeding

File to create:
- `backend/app/baseline/seeder.py`

`seed_baseline_for_cluster(cluster_id, adapter, db)`:
- Calls `adapter.get_metrics()` with 30-day lookback for all metrics in the normalisation map
- Feeds samples into `compute_baseline()` from existing `baseline/engine.py`
- Calls `upsert_baseline()` for each metric + window type combination
- Skips metrics with fewer than `BASELINE_MIN_SAMPLES` samples (logs a warning)
- Returns a summary: how many baselines seeded, how many skipped

This function is called once per new cluster, not on every run cycle.

**Done when:** Running `seed_baseline_for_cluster()` against a real cluster produces baseline rows in the `baseline_profiles` table with valid p50/p95/mean/std_dev values.

---

### Step 6 — Analyzer runner

File to create:
- `backend/app/runner/analyzer_runner.py`

`run_cycle(adapter, db)` — one full pass across all clusters:

```
for each cluster in adapter.get_clusters():
    upsert cluster in clusters table if not exists
    
    if cluster has no baseline:
        call seed_baseline_for_cluster()
    
    fetch capability_map for this cluster
    
    for each analyzer where runnable_status in (runnable, reduced):
        fetch latest metric values for this analyzer's required metrics
        fetch baselines for this cluster (window_type=all)
        
        run analyzer.analyze(metrics, baselines, log_signals={}, metric_ts=now)
        
        call verdict_writer.write(cluster_id, verdict_result, db)
```

`start_runner(adapter)` — background task entry point:
- Calls `run_cycle()` on startup
- Then repeats every `ANALYZER_RUN_INTERVAL_SECONDS`
- Catches and logs exceptions without crashing the process

Register in `backend/app/main.py` as a FastAPI `lifespan` background task.

**Done when:** Running `run_cycle()` manually produces real verdicts in the database from the real Grafana Cloud data.

---

### Step 7 — Verdict writer

File to create:
- `backend/app/runner/verdict_writer.py`

`write(cluster_id, verdict_result, db)`:

```
1. Query most recent verdict for cluster_id + analyzer_name
   SELECT * FROM verdicts
   WHERE cluster_id = ? AND analyzer_name = ?
   ORDER BY run_at DESC
   LIMIT 1

2. Set prev_status = previous verdict's status (or None if first run)

3. INSERT new row into verdicts with:
   - all VerdictResult fields
   - prev_status
   - metric_ts = verdict_result.metric_ts
   - ingested_at = now (when we received the metric from Grafana)
   - run_at = now (when analyzer ran)
   - data_freshness = compute_freshness(metric_ts, run_at)

4. INSERT one row per evidence item into verdict_evidence

5. If new_status != prev_status (or prev_status is None):
   call generate_llm_explanation(verdict_result, db)
   store result in llm_explanations

6. UPDATE clusters.current_status to worst status across all verdicts
   for this cluster in the last run cycle
```

`generate_llm_explanation(verdict_result, verdict_id, db)`:
- Builds prompt from verdict fields (observed, baseline_summary, root_cause, recommendation, evidence)
- Calls Anthropic API using settings.anthropic_api_key and settings.anthropic_model
- Stores result in llm_explanations with input/output token counts
- If API call fails, logs error and returns without raising (verdict persistence takes priority)

`compute_freshness(metric_ts, run_at)`:
- `run_at - metric_ts < 2 minutes` → fresh
- `run_at - metric_ts < 10 minutes` → delayed
- `run_at - metric_ts >= 10 minutes` → gap
- First run with no previous verdict → pending

**Done when:** A status change (e.g. healthy → degraded) triggers an LLM explanation that appears in `llm_explanations` table with real text. A repeated run with same status does NOT trigger the LLM.

---

### Step 8 — Frontend API client

File to create:
- `src/services/api.ts`

```typescript
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function getClusters(): Promise<ClusterResponse[]>
export async function getCluster(clusterId: string): Promise<ClusterResponse>
export async function getVerdicts(clusterId: string): Promise<VerdictResponse[]>
export async function getBaselines(clusterId: string): Promise<BaselineResponse[]>
```

Each function:
- Calls the corresponding FastAPI endpoint
- Throws a typed error on non-200 response
- Returns typed response data

Update these components to use the API client instead of mock data:
- `src/pages/OverviewPage.tsx` — cluster list and health status
- `src/pages/DatabaseDetailPage.tsx` — cluster detail, verdicts, baselines
- `src/components/layout/CommandPalette.tsx` — cluster search

Add loading states and error states to each component that now fetches real data. The existing mock data generators can remain as fallback for components not yet connected.

**Done when:** The overview page shows real clusters from Grafana Cloud with real health statuses from real verdicts — not mock data.

---

### Step 9 — Integration test (end to end)

With everything above built:

1. Start docker-compose: `docker compose up`
2. Verify backend health: `GET /health` returns 200
3. Verify runner started: logs show "Analyzer runner started" and "Run cycle complete"
4. Verify clusters: `GET /clusters/` returns real clusters from Grafana Cloud
5. Verify verdicts: `GET /verdicts/cluster/<id>` returns at least one verdict with status populated
6. Verify baselines: `GET /baselines/cluster/<id>` returns baselines with valid percentile values
7. Verify frontend: open `http://localhost:5173` and confirm real cluster names appear
8. Verify LLM: check `llm_explanations` table has at least one row with real explanation text

---

## 7. Acceptance criteria per component

### GrafanaCloudAdapter
- [ ] `get_clusters()` returns at least one real cluster identifier
- [ ] `get_metrics()` returns correctly normalised `CanonicalMetric` objects for all Phase 1 analyzer metrics
- [ ] `get_latest_metrics()` returns a dict with current values for all required metrics
- [ ] 401 raises `AdapterAuthError` with clear message
- [ ] 429 retries with backoff before failing
- [ ] Missing metric raises `AdapterMetricNotFoundError` naming the missing metric

### Baseline seeder
- [ ] After seeding, `baseline_profiles` table contains rows for all three window types (all, weekday, weekend) per metric per cluster
- [ ] Baselines with fewer than 100 samples are not written and are logged as warnings
- [ ] p50 < p75 < p95 < p99 for every baseline (sanity check — if not, something is wrong with the data)

### Analyzer runner
- [ ] `run_cycle()` completes without exception against a real Grafana Cloud instance
- [ ] At least one verdict is written to the `verdicts` table after the first run cycle
- [ ] Clusters not previously in the database are auto-registered in `clusters` table
- [ ] Runner restarts automatically if a single cluster's run fails (does not crash the whole cycle)

### Verdict writer
- [ ] Every call to `write()` inserts exactly one new row in `verdicts` (never updates)
- [ ] Evidence items are written to `verdict_evidence` with correct `confidence_delta` values
- [ ] LLM is called exactly once when status changes from X to Y
- [ ] LLM is NOT called when status is the same as the previous verdict
- [ ] LLM failure does not prevent verdict from being written
- [ ] `clusters.current_status` reflects the worst active status after every write

### Frontend API client
- [ ] Overview page shows real cluster names and statuses (not mock data)
- [ ] Cluster detail page shows real verdicts with evidence
- [ ] Cmd+K search finds real clusters by name
- [ ] Loading state shown while API calls are in flight
- [ ] Error state shown if API is unreachable (not a blank page or crash)

---

## 8. What is explicitly out of scope for this phase

Do not build these. They belong in a future phase.

- Log signal extraction or ingestion (no log agent, no `/ingest/logs` testing)
- Prometheus remote_write receiver (push-based path — future phase)
- Shard allocation and thread pool analyzers (Phase 1 but after adapter is validated)
- MySQL or Cassandra adapters
- Onboarding discovery endpoint
- Notification or alerting on status change
- Billing intelligence
- Multi-tenant support (single tenant for now — one Grafana Cloud instance)

---

## 9. File map — everything this phase creates or modifies

### New files
```
backend/app/adapters/__init__.py
backend/app/adapters/base.py
backend/app/adapters/grafana_cloud/__init__.py
backend/app/adapters/grafana_cloud/adapter.py
backend/app/adapters/grafana_cloud/normalisation.py
backend/app/adapters/grafana_cloud/DISCOVERY_NOTES.md
backend/app/baseline/seeder.py
backend/app/runner/__init__.py
backend/app/runner/analyzer_runner.py
backend/app/runner/verdict_writer.py
backend/tests/test_adapters/__init__.py
backend/tests/test_adapters/test_grafana_cloud.py
backend/tests/test_runner/__init__.py
backend/tests/test_runner/test_verdict_writer.py
src/services/api.ts
```

### Modified files
```
backend/app/core/config.py         ← add Grafana Cloud + runner settings
backend/app/main.py                ← register runner as lifespan background task
backend/.env.example               ← add new env vars with comments
src/pages/OverviewPage.tsx         ← use API client instead of mock data
src/pages/DatabaseDetailPage.tsx   ← use API client instead of mock data
src/components/layout/CommandPalette.tsx ← use API client for cluster search
```

### Unchanged files (do not touch)
```
backend/app/analyzers/             ← analyzers are correct, do not modify
backend/app/baseline/engine.py    ← baseline engine is correct, do not modify
backend/app/models/models.py      ← schema is correct, do not modify
backend/app/schemas/schemas.py    ← schemas are correct, do not modify
```

---

## 10. Environment setup for this phase

Add to `backend/.env` before running:

```bash
# Grafana Cloud — required for this phase
GRAFANA_CLOUD_PROMETHEUS_URL=https://prometheus-prod-XX.grafana.net/api/prom
GRAFANA_CLOUD_API_KEY=glc_xxxxxxxxxxxx

# Will be auto-discovered in Step 1 — update after discovery
GRAFANA_CLOUD_CLUSTER_LABEL=cluster

# Anthropic — required for LLM explanations on status change
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx

# Analyzer runner
ANALYZER_RUN_INTERVAL_SECONDS=300
BASELINE_LOOKBACK_DAYS=30
BASELINE_MIN_SAMPLES=100
```

Install new dependency:

```bash
cd backend
pip install httpx --break-system-packages
```

`httpx` is needed for the async Grafana Cloud HTTP client. It is already compatible with the FastAPI async environment.

---

## 11. Known risks and mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Metric names in Grafana Cloud don't match expected ES exporter names | Medium | Discovery step (Section 4) resolves this before any code is written |
| Grafana Cloud rate limits metric queries during baseline seeding (30 days × N metrics) | Medium | Seed one cluster at a time. Add 100ms delay between queries. Respect 429 responses with backoff. |
| Baseline seeding takes too long for clusters with many metrics | Low | Run seeding as a one-time background job. API remains available during seeding. |
| LLM explanation quality is poor for the first analyzer (jvm_heap_pressure) | Medium | The system prompt in verdict_writer.py controls quality. Iterate on prompt before shipping. Log all LLM inputs/outputs during testing. |
| Frontend shows empty state while first run cycle completes | High | Expected behaviour. Show "Analyzer run in progress" state. First verdicts appear within ANALYZER_RUN_INTERVAL_SECONDS of startup. |

---

*DB Intelligence Platform — Build Plan v1.0 — April 2026*  
*Feed this document to Claude Code in plan mode before starting implementation.*
