# Push Ingest Architecture
## Detailed Technical Design

**Date:** 2026-04-14
**Status:** Ready to build
**Depends on:** Phase 1 complete (scheduler live, tenant isolation in dashboard)

---

## 0. What we discovered before writing this

### What already exists (don't rebuild)

| Component | Location | Status |
|-----------|----------|--------|
| `/ingest/metrics` route | `app/api/routes/ingest.py` | Exists — wrong design, needs replacement |
| `NormalisationMap` table | `models.py` | Correct — use this as canonical store |
| `UnmappedMetric` table | `models.py` | Exists — never written to, needs wiring |
| `Cluster` auto-create | `ingest.py:get_or_create_cluster()` | Exists — doesn't set `stack_id`, needs fix |
| `ClusterMetricRegistry` | `models.py` | Exists — correct, keep |
| `Stack` / `Tenant` models | `models.py` | Exists — not used by ingest at all |

### What is wrong with the current `/ingest/metrics`

1. **Dual normalisation maps** — `ES_METRIC_MAP` hardcoded in the file, completely separate
   from the DB-backed `NormalisationMap`. One source of truth must win — the DB table wins.
2. **Silently drops unknown metrics** — no write to `unmapped_metrics`. Product team is blind.
3. **Auto-created clusters have no `stack_id`** — orphaned from tenant hierarchy. Multi-tenancy impossible.
4. **No auth** — any caller can push metrics to any cluster. No bearer token validation.
5. **No derived metric computation** — `jvm.heap.used.percent` requires `used_bytes / max_bytes * 100`. The current handler can't compute this from two raw samples.
6. **No analyzer trigger** — metrics arrive, registry is updated, nothing runs. The analysis cycle is never triggered by push. Everything still depends on the pull scheduler.
7. **ES only** — `ES_METRIC_MAP` has no MySQL entries. MySQL push doesn't work.

### Key facts that shape the design

- `Cluster.cluster_id` is a composite string: `"{segment}|{region}|{name}"` — push senders must include this in their labels or we must derive it
- `NormalisationMap` has `(source_type, db_type, raw_metric_name)` unique key — perfect for push normalisation
- `SourceType` enum only has `grafana_cloud` and `datadog` — need a new `push` value
- The analyzer pipeline takes `dict[str, float]` — completely source-agnostic, unchanged
- Pool size: 10 connections, max_overflow 20 — sufficient for prototype push volume

---

## 1. Architecture overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  PUSH SENDERS                                                        │
│                                                                      │
│  Prometheus remote_write ──┐                                         │
│  OTEL collector            ├──► POST /ingest/metrics                 │
│  Custom JSON agent         ┘    (bearer token auth)                  │
└─────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INGEST LAYER  (app/ingest/)                                         │
│                                                                      │
│  1. Auth        — validate bearer token → (tenant_id, stack_id)     │
│  2. Parse       — protobuf or JSON → raw samples list               │
│  3. Route       — group samples by cluster_id from labels           │
│  4. Normalise   — raw_metric_name → canonical_name via NormMap DB   │
│  5. Derive      — compute heap% from used_bytes/max_bytes           │
│  6. Accumulate  — collect canonical dict per cluster                │
│  7. Register    — upsert ClusterMetricRegistry                      │
│  8. Record miss — unknown metrics → unmapped_metrics table          │
│  9. Queue       — push canonical dict to analyzer queue             │
│  10. Return     — 202 Accepted (never block on analysis)            │
└─────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  ANALYZER QUEUE  (app/ingest/queue.py)                               │
│                                                                      │
│  asyncio.Queue — one message per (tenant_id, cluster_id, metrics)   │
│  N worker coroutines drain the queue concurrently                   │
│  Each worker calls run_cluster_from_metrics() — same logic as pull  │
└─────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  INTELLIGENCE PIPELINE  (unchanged)                                  │
│                                                                      │
│  Baselines → Analyzers → VerdictWriter → LLM (on status change)     │
│  Same code as pull. Takes dict[str, float]. Doesn't know or care    │
│  where the metrics came from.                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Auth: ingest tokens

### New table: `ingest_tokens`

```sql
ingest_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    stack_id    UUID NOT NULL REFERENCES stacks(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL,          -- SHA-256(raw_token), never store plaintext
    label       VARCHAR(128),           -- human label e.g. "prod-prometheus"
    is_active   BOOLEAN DEFAULT true,
    last_used_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
)
```

### How it works

1. When a customer onboards a push stack, the platform generates a random 32-byte token
2. Returns the raw token **once** — never shown again
3. Stores `SHA-256(raw_token)` in `token_hash`
4. On every push request: hash the incoming bearer token, lookup in `ingest_tokens`, get `(tenant_id, stack_id)`
5. Token not found or `is_active=false` → 401

### New `SourceType` enum value

```python
class SourceType(str, enum.Enum):
    grafana_cloud = "grafana_cloud"
    datadog       = "datadog"
    push          = "push"              # ← new: customer pushes to us
```

Stacks created for push senders use `source_type=push`. No `api_endpoint` or `api_key_ref` needed (we issue the token, not them). Migration required.

---

## 3. Ingest endpoint design

### 3.1 Simple JSON format (Phase 2.1 — build first)

```
POST /ingest/metrics
Authorization: Bearer {ingest_token}
Content-Type: application/json

{
  "cluster_id": "Alpha|us-east1|els_shrdone_alpha_va",
  "db_type": "elasticsearch",
  "timestamp": "2026-04-14T14:00:00Z",
  "metrics": {
    "elasticsearch_jvm_memory_used_bytes": 4294967296,
    "elasticsearch_jvm_memory_max_bytes":  8589934592,
    "elasticsearch_jvm_gc_collection_seconds_sum": 0.42,
    "elasticsearch_thread_pool_rejected_count": 0.0
  }
}
```

Response: `202 Accepted` — analysis happens async.

**Why JSON first:** Easier to test with curl. Customer can send from any language.
Prometheus remote_write (protobuf) comes in Phase 2.5 once JSON is proven.

### 3.2 Per-instance variant (needed for per-node verdicts)

```json
{
  "cluster_id": "Alpha|us-east1|els_shrdone_alpha_va",
  "db_type": "elasticsearch",
  "timestamp": "2026-04-14T14:00:00Z",
  "metrics": {
    "elasticsearch_jvm_memory_used_bytes": 4294967296,
    "elasticsearch_jvm_memory_max_bytes":  8589934592
  },
  "instances": {
    "lpggce-a-elsshrd1-usea1-1": {
      "elasticsearch_jvm_memory_used_bytes": 3800000000,
      "elasticsearch_jvm_memory_max_bytes":  8589934592
    },
    "lpggce-a-elsshrd1-usea1-2": {
      "elasticsearch_jvm_memory_used_bytes": 4800000000,
      "elasticsearch_jvm_memory_max_bytes":  8589934592
    }
  }
}
```

The `metrics` dict is the cluster-level aggregate. `instances` dict provides per-node breakdowns. Both are optional but at least one is required.

### 3.3 Prometheus remote_write (Phase 2.5)

Standard `application/x-protobuf` with `X-Prometheus-Remote-Write-Version: 0.1.0`.
Parse using the `prometheus_client` protobuf format.
Cluster identity comes from labels: `lp_cluster`, `lp_segment`, `datacenter`.
Instance identity comes from `instance` label.

---

## 4. Normalisation at ingest

### The single source of truth

Replace the hardcoded `ES_METRIC_MAP` in `ingest.py` with DB-backed lookup:

```python
# app/ingest/normaliser.py

async def load_norm_map(
    db: AsyncSession,
    source_type: SourceType,
    db_type: DbType,
) -> dict[str, NormEntry]:
    """
    Load normalisation map from DB for this (source_type, db_type) pair.
    Returns: {raw_metric_name: NormEntry(canonical_name, category, unit)}
    Cached in-process with a 5-minute TTL.
    """

async def normalise_batch(
    raw_metrics: dict[str, float],
    norm_map: dict[str, NormEntry],
) -> tuple[dict[str, float], list[str]]:
    """
    Returns:
      canonical_metrics: {canonical_name: value}  — mapped ones
      unmapped_names:    [raw_metric_name, ...]    — failed to map
    """
```

### Derived metric computation at ingest

Pull adapter computes `jvm.heap.used.percent` via PromQL arithmetic.
Push ingest receives raw samples — must compute it in Python:

```python
# app/ingest/derived.py

DERIVED_RULES: list[DerivedRule] = [
    DerivedRule(
        output_canonical="jvm.heap.used.percent",
        inputs=["jvm.heap.used.bytes", "jvm.heap.max.bytes"],
        compute=lambda v: (v["jvm.heap.used.bytes"] / v["jvm.heap.max.bytes"]) * 100,
        db_types=[DbType.elasticsearch],
    ),
    DerivedRule(
        output_canonical="mysql.buffer.pool.pressure.pct",
        inputs=["mysql.buffer.pool.bytes", "mysql.memory.total.bytes"],
        compute=lambda v: (v["mysql.buffer.pool.bytes"] / v["mysql.memory.total.bytes"]) * 100,
        db_types=[DbType.mysql],
    ),
    DerivedRule(
        output_canonical="mysql.connection.pct",
        inputs=["mysql.connections.current", "mysql.connections.max"],
        compute=lambda v: (v["mysql.connections.current"] / v["mysql.connections.max"]) * 100,
        db_types=[DbType.mysql],
    ),
    DerivedRule(
        output_canonical="fs.used.percent",
        inputs=["fs.total.total.bytes", "fs.total.available.bytes"],
        compute=lambda v: ((v["fs.total.total.bytes"] - v["fs.total.available.bytes"])
                          / v["fs.total.total.bytes"]) * 100,
        db_types=[DbType.elasticsearch, DbType.mysql],
    ),
]

def apply_derived_rules(
    canonical_metrics: dict[str, float],
    db_type: DbType,
) -> dict[str, float]:
    """
    Given a canonical metric dict, compute and add any derivable metrics.
    Runs after normalisation. Returns the augmented dict.
    """
```

This logic is **shared** — the pull adapter's PromQL templates and the push ingest's
Python computation produce the same canonical dict. Analyzers see identical input
regardless of source.

### Unmapped metric recording

```python
async def record_unmapped(
    db: AsyncSession,
    tenant_id: UUID,
    stack_id: UUID,
    source_type: SourceType,
    db_type: DbType,
    raw_name: str,
    sample_value: float,
) -> None:
    """
    Upsert into unmapped_metrics: increment occurrence_count if exists,
    insert with count=1 if new. Never raises — logging only on failure.
    """
```

---

## 5. Analyzer queue

### Phase 2 (asyncio, no new dependencies)

```python
# app/ingest/queue.py

from asyncio import Queue
from dataclasses import dataclass
from uuid import UUID

@dataclass
class AnalysisJob:
    tenant_id:        UUID
    cluster_id:       str           # composite string key
    db_type:          DbType
    metrics:          dict[str, float]             # cluster-level canonical
    per_instance:     dict[str, dict[str, float]]  # {instance_id: {canonical: value}}
    received_at:      datetime

_queue: Queue[AnalysisJob] = Queue(maxsize=500)  # back-pressure at 500 pending jobs

async def enqueue(job: AnalysisJob) -> None:
    """Non-blocking put. Drops job and logs warning if queue is full."""
    try:
        _queue.put_nowait(job)
    except asyncio.QueueFull:
        logger.warning(f"Analysis queue full — dropping job for {job.cluster_id}")

async def worker_loop(worker_id: int) -> None:
    """Drain the queue. One coroutine per worker. Started in lifespan."""
    while True:
        job = await _queue.get()
        try:
            await run_cluster_from_metrics(
                cluster_id=job.cluster_id,
                metrics=job.metrics,
                per_instance=job.per_instance,
                run_at=job.received_at,
            )
        except Exception as e:
            logger.error(f"[worker-{worker_id}] {job.cluster_id}: {e}", exc_info=True)
        finally:
            _queue.task_done()
```

**Number of workers:** Start with 3. Each worker holds one DB session. At 9 clusters
and 30-second push intervals, 3 workers is comfortable headroom.

### Phase 3 upgrade path (Redis Streams)

When workers exceed asyncio capacity, swap `_queue` for Redis Streams:
- `XADD ingest-jobs * cluster_id ... metrics ...`
- Consumer groups for multiple worker processes
- Dead letter stream for failed jobs
- Zero changes to `run_cluster_from_metrics()` — only the queue interface changes

---

## 6. Runner: decoupling from pull

Currently `run_cluster()` in `analyzer_runner.py` fetches metrics from Grafana inside
itself. For push, metrics arrive pre-fetched. We need to split the function:

### Current (pull-coupled)
```python
async def run_cluster(db, cluster_composite_id: str, run_at: datetime) -> None:
    # step 1: resolve cluster from DB
    # step 2: create GrafanaCloudAdapter
    # step 3: fetch metrics via adapter    ← pull-specific
    # step 4: load baselines
    # step 5: run analyzers
    # step 6: write verdicts
    # step 7: update cluster status
```

### New design (source-agnostic)
```python
async def run_cluster_from_metrics(
    db,
    cluster_composite_id: str,
    metrics: dict[str, float],
    per_instance: dict[str, dict[str, float]],
    run_at: datetime,
) -> None:
    """
    Run a full analysis cycle given pre-fetched canonical metrics.
    Used by both the push queue workers and (soon) the pull scheduler.
    Steps: resolve cluster → load baselines → run analyzers → write verdicts → update status.
    No adapter. No Grafana call. Pure intelligence pipeline.
    """

async def run_cluster(db, cluster_composite_id: str, run_at: datetime) -> None:
    """
    Pull path: fetch metrics from Grafana, then call run_cluster_from_metrics().
    Unchanged from the caller's perspective.
    """
    # ... resolve cluster, create adapter, fetch metrics (unchanged) ...
    await run_cluster_from_metrics(db, cluster_composite_id, metrics, per_instance, run_at)
```

`run_cluster()` stays backward compatible. `run_cluster_from_metrics()` becomes the
shared core that both paths use.

---

## 7. Auto-discover clusters from push

When a push payload arrives for a `cluster_id` that doesn't exist in the DB yet:

```python
async def get_or_create_cluster(
    db: AsyncSession,
    cluster_id: str,
    db_type: DbType,
    stack_id: UUID,      # ← now required — links to tenant
) -> Cluster:
    cluster = await db.get(Cluster, cluster_id)  # lookup by cluster_id string
    if cluster:
        return cluster

    # Auto-create with unknown status
    cluster = Cluster(
        cluster_id=cluster_id,
        db_type=db_type,
        stack_id=stack_id,
        display_name=cluster_id.split("|")[-1],  # last segment as display name
        current_status=HealthStatus.unknown,
    )
    db.add(cluster)
    await db.flush()
    logger.info(f"Auto-created cluster {cluster_id} from push payload")
    return cluster
```

Customer sees the cluster appear in the dashboard as `unknown` immediately.
Status changes to a real verdict after first analysis cycle.

---

## 8. Baseline auto-seed trigger

Currently baselines are seeded manually (run `seeder.py` once). For push:

```python
# After each successful analysis cycle for a push cluster:

baseline_count = await count_metric_samples_available(cluster_id)
if baseline_count >= settings.baseline_min_samples and not await has_baselines(cluster_id):
    logger.info(f"Auto-triggering baseline seed for {cluster_id}")
    asyncio.create_task(seed_baselines_for_cluster(cluster_id))
```

`seed_baselines_for_cluster()` calls the Grafana pull adapter's `get_metrics()` range
query for the last 30 days — same as the manual seeder, just triggered automatically
when enough metric samples have arrived to indicate the cluster is real and active.

For air-gapped push-only clusters (no Grafana access), baseline seeds from the
accumulation of pushed samples instead. This requires a lightweight sample buffer —
Phase 3 scope.

---

## 9. Files to create / modify

### New files

```
backend/app/ingest/
    __init__.py
    normaliser.py       — DB-backed normalisation, derived metric rules, unmapped recording
    queue.py            — asyncio.Queue, AnalysisJob, worker_loop, enqueue
    auth.py             — bearer token validation, IngestToken lookup
    derived.py          — DerivedRule definitions and apply_derived_rules()

backend/app/models/
    (add IngestToken to models.py — not a new file)

backend/migrations/versions/
    xxx_add_ingest_tokens_push_source_type.py
```

### Modified files

| File | Change |
|------|--------|
| `app/models/models.py` | Add `IngestToken` model; add `push` to `SourceType` enum |
| `app/api/routes/ingest.py` | Replace `ES_METRIC_MAP` with DB normaliser; add auth; wire unmapped; trigger queue |
| `app/runner/analyzer_runner.py` | Extract `run_cluster_from_metrics()` from `run_cluster()` |
| `app/main.py` | Start N worker coroutines in lifespan alongside scheduler |
| `app/core/config.py` | Add `push_worker_count: int = 3` |

### Do not touch

```
app/analyzers/          — unchanged
app/baseline/engine.py  — unchanged
app/runner/llm_explainer.py — unchanged
```

---

## 10. Migration steps in order

```
Step 1  — Add IngestToken model + migration
          Add push to SourceType enum + migration
          Run: alembic revision --autogenerate -m "add_ingest_tokens_push_source_type"
          Run: alembic upgrade head

Step 2  — Build app/ingest/auth.py
          Bearer token hashing (SHA-256), lookup, 401 on fail

Step 3  — Build app/ingest/normaliser.py
          Load NormalisationMap from DB (replace ES_METRIC_MAP)
          5-minute in-process TTL cache
          Record unknowns to unmapped_metrics

Step 4  — Build app/ingest/derived.py
          DerivedRule dataclass + DERIVED_RULES list
          apply_derived_rules() function

Step 5  — Build app/ingest/queue.py
          AnalysisJob dataclass, asyncio.Queue, enqueue(), worker_loop()

Step 6  — Refactor app/runner/analyzer_runner.py
          Extract run_cluster_from_metrics()
          run_cluster() calls it (pull path unchanged)

Step 7  — Rewrite app/api/routes/ingest.py
          New POST /ingest/metrics handler (JSON format)
          Auth → normalise → derive → auto-create cluster → register → queue
          Return 202

Step 8  — Wire workers into main.py lifespan
          Start push_worker_count worker coroutines
          Cancel cleanly on shutdown

Step 9  — CLI to issue ingest tokens
          backend/scripts/issue_ingest_token.py --tenant-id X --label "prod-prometheus"
          Prints raw token once, stores hash in DB

Step 10 — Test end-to-end
          curl POST /ingest/metrics with JSON payload
          Verify cluster appears in dashboard
          Verify verdict fires within 30 seconds
          Verify unmapped metrics recorded for unknown names
```

---

## 11. What the customer does to set up push

After running `issue_ingest_token.py`, the customer gets:

```
Ingest token created.
Token (shown once — save this now):

  dbi_live_a8f3k2p9qm4n7x1z6j0

Stack:    GCP Prod DB — Elasticsearch
Tenant:   Acme Corp
Label:    prod-prometheus
```

They add to their `prometheus.yml`:

```yaml
remote_write:
  - url: https://api.dbintelligence.io/ingest/metrics
    authorization:
      credentials: dbi_live_a8f3k2p9qm4n7x1z6j0
    write_relabel_configs:
      - source_labels: [__name__]
        regex: "elasticsearch_.*|mysql_.*|node_.*"
        action: keep
      - source_labels: [lp_segment, datacenter, lp_cluster]
        separator: "|"
        target_label: cluster_id
        action: replace
```

That's it. Within 15 seconds of the next scrape, metrics start arriving. The cluster
appears in the dashboard as `unknown`. After 5 minutes (first scheduler run), verdicts appear.

---

## 12. Capacity at scale

| Scale | Ingest rate | Workers | Queue depth | DB connections |
|-------|------------|---------|-------------|----------------|
| 1 customer, 9 clusters, 60s scrape | ~150 samples/min | 3 | < 10 | 3 |
| 10 customers, 90 clusters, 60s scrape | ~1,500 samples/min | 5 | < 50 | 5 |
| 100 customers, 1,000 clusters, 60s scrape | ~15,000 samples/min | — Redis Streams — | — | — |

At 100 customers, the asyncio queue saturates and Redis Streams + Celery workers
replace it. The interface (`enqueue()`, `AnalysisJob`) stays identical — only the
queue backend changes. Zero changes to the intelligence pipeline.

---

## 13. What this unlocks that pull can't do

| Capability | Pull | Push |
|------------|------|------|
| Works in air-gapped network | No | Yes |
| Detection latency | 5 minutes | < 30 seconds |
| No API quota concern | No | Yes |
| Customer controls sampling rate | No | Yes |
| Zero platform-side credentials | No | Yes — token only |
| Onboarding time | 10 min (API key setup) | 5 min (4 lines in prometheus.yml) |
| Works without Grafana | No | Yes |
| Per-node granularity | Yes (per-instance PromQL) | Yes (instances dict) |
