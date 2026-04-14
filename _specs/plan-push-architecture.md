# DB Intelligence Platform — Push Architecture Plan
## Thinking as PM, Customer, and Architect

**Date:** 2026-04-14  
**Status:** Planning — not started  
**Replaces:** Current pull-only model via GrafanaCloudAdapter

---

## 0. Why this document exists

The current architecture pulls metrics from Grafana Cloud on a manual/cron basis.
It works for the prototype. It will not work at scale. 

This document answers three questions:
1. What does a customer actually want from this product?
2. What does the platform need to do to serve 1 to 100 customers?
3. How do we get there from where we are today — without breaking what works?

---

## 1. What the customer actually wants

### The customer profile

A mid-size engineering team (50–500 engineers) running 20–200 database clusters
across GCP, AWS, or on-prem. They have:
- Grafana Cloud or Datadog already deployed — they're not going to rip it out
- An SRE team of 2–10 people who are already on-call for database incidents
- A VP of Engineering who wants to reduce database-related incidents by 50%
- Engineers who have been burned by "the dashboard looked fine but prod was on fire"

### What they want — in their own words

> "I want to know about a problem before my users do — not after a ticket is filed."

> "I don't want another dashboard. I want someone to tell me what's wrong,
>  why it's wrong, and what to do. I'll look at the charts myself."

> "I need this to work with what I already have. I'm not replacing Grafana."

> "When it fires an alert, I need to trust it. False positives kill trust."

> "I need to know which specific node is the problem, not just 'the cluster'."

> "I need this product to reduce my MTTR and help me identify the root cause
>  on both historical data and live data." ← added by user, 2026-04-14

> "I need this product to reduce my MTTR, and help me identify the root cuause both on historical data and live"

### What they do NOT want

- Another tool that requires a 2-week setup
- An agent that modifies their databases
- A black-box score with no explanation
- Alerts based on static thresholds they have to tune manually
- A tool that only works if Grafana is up

### The buying trigger

An SRE opens the platform after a production incident, sees that the tool had
already flagged the root cause 45 minutes earlier, and shows it to their manager.
That's the moment they buy.

---

## 2. The core product promise (what we're building toward)

From plan-master.md section 1.1 — the Core Mantra:

> When there is an incident, the DBA on-call logs in, asks what is wrong with
> their cluster or node, and the platform tells them — guiding them to a fix
> and reducing MTTR. It works on both historical data and live data.

```
Customer's metrics → DB Intelligence → "Here's what's wrong, why, and what to do"
```

The platform must:
1. **Receive metrics** from whatever the customer already uses (Grafana, Datadog,
   Prometheus, OTEL) — pull OR push, their choice
2. **Detect anomalies** using baseline-aware analyzers, not static thresholds
3. **Explain verdicts** in plain English using LLM, with evidence
4. **Surface node-level detail** — not just cluster-level averages
5. **Be trustworthy** — low false positive rate, high confidence scoring
6. **Reduce MTTR** — the DBA should find the answer here faster than digging through Grafana
7. **Work for 1 customer or 100** without re-architecting
8. **Support historical queries** — "what was happening at 2am when the incident started?"

---

## 3. Why push — the honest reason

### Pull works fine until it doesn't

Pull (current model) works for the prototype because:
- We have one customer (ourselves)
- We have one source system (Grafana Cloud)
- We run the analyzer manually

Pull breaks at scale because:
- **Credential sprawl**: 50 customers × 2 source systems = 100 API keys to store, rotate, audit
- **API quota**: Grafana Cloud has rate limits. 100 customers × 9 clusters × 10 metrics × every 5 min = quota exhaustion
- **Network dependency**: Platform goes outbound through customer firewall — blocked in air-gapped environments
- **Poll lag**: Pull every 5 min means a problem is invisible for up to 5 minutes before we even see it
- **Source system coupling**: If Grafana is down, our platform is blind
- **Onboarding friction**: Customer must give us API keys to their monitoring platform — security teams reject this

### Push solves all of these

- **No credentials to store**: Customer pushes to us — we issue them a token, they configure their exporter
- **No quota exposure**: Customer controls their own push rate
- **Firewall-friendly**: Outbound HTTPS from customer → our endpoint. No inbound requirements
- **Near-real-time**: Metrics arrive as they're scraped (every 15–60 seconds), not every 5 minutes
- **Source system independence**: Customer can switch from Grafana to Datadog — they just change the exporter target, not our platform
- **Standard protocols**: Prometheus `remote_write` is already configured in 90% of existing setups. Zero new agent required.

### We keep pull — we add push

Pull is not wrong. For customers who are already on Grafana Cloud, pull is the
easiest onboarding path (provide API key → done). We keep it. Push is additive.
The architecture supports both. The customer chooses.

---

## 4. What "scale to 1–100 customers" actually means

### At 1 customer (today)
- 1 tenant, 9 clusters, 1 source system
- Manual analyzer runs
- One Grafana API key in `.env`
- Single process

### At 10 customers
- 10 tenants, ~100 clusters, 2–3 source systems
- Analyzer must run automatically every 5 minutes per cluster
- Credentials per-tenant in a secret store, not `.env`
- Tenant isolation must be enforced in every DB query
- Push ingest endpoint live — customers can onboard without giving us their Grafana key

### At 100 customers
- 100 tenants, ~1,000+ clusters, multiple source systems
- Ingest volume: ~10,000 metric samples/minute at 60s scrape intervals
- Analyzer pipeline must be concurrent, not sequential
- Queue-based: ingest → queue → analyzer workers → verdict writer
- Multi-region: customers in EU need data to stay in EU
- SLA-grade availability: ingest endpoint must be 99.9% up
- Rate limiting per tenant: one noisy customer can't starve others

### Scale is not just traffic — it's operational complexity

At 100 customers, the hard problems are:
- Onboarding: customer must be able to set up in < 30 minutes without our help
- Tenant isolation: one tenant's data must never appear in another tenant's view
- Baseline integrity: each tenant's baselines must be seeded from their own data
- Credential security: no plaintext keys in any table
- Audit trail: what did the system decide, when, why — for every tenant

---

## 5. Architecture design

### 5.1 The two data paths (pull and push coexist)

```
┌─────────────────────────────────────────────────────────────────┐
│  PULL PATH (existing customers, Grafana/Datadog)                │
│                                                                  │
│  Grafana Cloud ──► GrafanaCloudAdapter ──► MetricDict           │
│  Datadog       ──► DatadogAdapter      ──► MetricDict           │
│                                              │                  │
└──────────────────────────────────────────────┼──────────────────┘
                                               │
┌──────────────────────────────────────────────┼──────────────────┐
│  PUSH PATH (new customers, self-hosted)       │                  │
│                                              │                  │
│  Prometheus remote_write ──► /ingest/metrics ──► MetricDict     │
│  OTEL collector          ──►      │                             │
│  Custom agent            ──►      │ normalise, validate         │
│                                   │ batch by cluster            │
└───────────────────────────────────┼─────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────────────────────────────────┐
│  SHARED INTELLIGENCE PIPELINE (same for both paths)           │
│                                                               │
│  MetricDict ──► AnalyzerRunner ──► VerdictWriter ──► LLM     │
│                 (per cluster,       (append-only     (status  │
│                  per tenant)        verdicts)         change) │
└───────────────────────────────────────────────────────────────┘
```

The key insight: **the analyzer pipeline is already decoupled from the data source**.
`run_cluster()` takes a `dict[str, float]` and doesn't care where it came from.
Push and pull both produce that same dict. The intelligence layer changes nothing.

### 5.2 Push ingest endpoint

```
POST /ingest/metrics
Authorization: Bearer {tenant_ingest_token}
Content-Type: application/x-protobuf   (Prometheus remote_write)
           OR application/json          (simple format)
           OR application/otlp+proto    (OTEL)
```

The endpoint:
1. Validates the bearer token → resolves `tenant_id` + `stack_id`
2. Parses the payload (protobuf or JSON)
3. Normalises raw metric names via `normalisation_map` table
4. Computes derived metrics (e.g., heap% from used_bytes/max_bytes) in-process
5. Batches samples by `cluster_id` (from label `lp_cluster` or equivalent)
6. Queues each cluster batch for the analyzer pipeline
7. Returns `202 Accepted` — never blocks on analysis

**What it does NOT do:**
- Store raw metric values (same constraint as pull)
- Block on analysis completion
- Accept metrics that don't match any known cluster (logs to `unmapped_metrics`)

### 5.3 Queue-based analyzer pipeline

```
Ingest Endpoint
     │
     ▼
┌──────────────┐
│  Work Queue  │  ← one message per (tenant_id, cluster_id, metric_batch)
└──────────────┘
     │
     ▼
┌──────────────────────┐
│  Analyzer Workers    │  ← N workers, each pulls from queue
│  (concurrent)        │     runs full analysis cycle
│                      │     writes verdict
│                      │     calls LLM on change
└──────────────────────┘
```

**At prototype scale (1–5 customers):** Queue = in-memory asyncio queue.
No Redis, no Celery. `asyncio.Queue` + background task workers.
Simple, zero new dependencies, works today.

**At production scale (10–100 customers):** Queue = Redis Streams or AWS SQS.
Worker pool = Celery workers or separate FastAPI background processes.
Swap the queue implementation without touching analyzer code.

The analyzer workers are the current `run_cluster()` function — unchanged.

### 5.4 Tenant isolation — the missing piece

Every query in the system must include `tenant_id`. Currently none do.

**Required changes:**
- `clusters` table needs `tenant_id` FK (or enforce through `stack_id → stacks.tenant_id`)
- Dashboard endpoint: `WHERE cluster.stack_id IN (SELECT id FROM stacks WHERE tenant_id = ?)`
- Analyzer runner: resolves cluster UUID scoped to tenant before running
- Ingest endpoint: all cluster lookups scoped to tenant from the bearer token
- Baselines: `get_baselines_for_cluster()` adds tenant scope

**Auth:** Bearer tokens issued at stack creation. Stored hashed (bcrypt or SHA-256)
in a new `ingest_tokens` table. Token → `(tenant_id, stack_id)` resolution.
No plaintext token ever stored.

### 5.5 Scheduler — the missing piece

Currently: analyzer runner is manual.
Required: runs automatically every N minutes per cluster.

**At prototype scale:** FastAPI lifespan background task.
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(scheduler_loop())
    yield
    task.cancel()

async def scheduler_loop():
    while True:
        await run_all_active_clusters()
        await asyncio.sleep(settings.analyzer_run_interval_seconds)
```

**At production scale:** Celery beat or AWS EventBridge.

**For push path:** Analyzer runs triggered by ingest, not by clock.
Metric arrives → queue → worker runs analysis immediately.
The 5-minute poll interval disappears. Analysis latency = ingest latency (seconds).

### 5.6 Onboarding flow

#### Pull onboarding (existing)
```
Customer provides: Grafana API key + instance ID
Platform does:    discover clusters → seed baselines → start polling
Time to first verdict: ~10 minutes
```

#### Push onboarding (new)
```
Customer does:    add remote_write target to their prometheus.yml
Platform does:    issue ingest token → wait for first push → auto-discover clusters
Time to first verdict: ~5 minutes after first push
```

**Prometheus config customer adds (literally 4 lines):**
```yaml
remote_write:
  - url: https://api.dbintelligence.io/ingest/metrics
    bearer_token: {token_issued_at_signup}
    write_relabel_configs:
      - source_labels: [__name__]
        regex: "elasticsearch_.*|mysql_.*|node_.*"
        action: keep
```

That's it. No agent. No SDK. No code changes. If they already run Prometheus, 
this is a 5-minute setup.

---

## 6. What needs to be built — in order

### Phase 1: Foundation (prerequisite for everything)

**Goal:** The platform works automatically, with proper tenant isolation, for the current 1-customer setup. No push yet. Just fix the foundation.

| # | What | Why first |
|---|------|-----------|
| 1.1 | **Ingest token table** — `ingest_tokens(id, tenant_id, stack_id, token_hash, created_at, last_used_at, is_active)` | Required by both push endpoint and future multi-tenant auth |
| 1.2 | **Tenant-scoped queries** — add `tenant_id` filter to dashboard endpoint and runner | Without this, 2 tenants see each other's data. Non-negotiable before any new customer |
| 1.3 | **Automated scheduler** — FastAPI lifespan background task running `run_all_active_clusters()` every 5 min | The product is currently blind between manual runs. Every customer expects continuous monitoring |
| 1.4 | **`analyzer_run_interval_seconds` wired in** — currently dead config | Connects the existing config to the new scheduler |

**Deliverable:** Platform analyzes all registered clusters automatically every 5 minutes. Tenant isolation enforced. One customer can be onboarded end-to-end without Claude running scripts.

---

### Phase 2: Push ingest endpoint

**Goal:** A customer running Prometheus can onboard by adding 4 lines to their config.

| # | What | Details |
|---|------|---------|
| 2.1 | **`POST /ingest/metrics` — JSON format** | Simplest format first: `{cluster_id, metrics: {name: value}, timestamp}`. Validates bearer token, normalises, queues for analysis. Skips protobuf complexity initially |
| 2.2 | **Auto-discover clusters from push** | When a cluster_id arrives that doesn't exist in DB, create a `clusters` row automatically (status=unknown). Don't require manual seeding |
| 2.3 | **Derived metric computation at ingest** | Compute `jvm.heap.used.percent` from `elasticsearch_jvm_memory_used_bytes` / `elasticsearch_jvm_memory_max_bytes` at ingest time. Move this logic out of PromQL templates into a shared computation layer |
| 2.4 | **Baseline auto-seed trigger** | When a cluster accumulates 100+ samples, automatically trigger baseline seeding. Customer doesn't need to run a script |
| 2.5 | **`POST /ingest/metrics` — Prometheus remote_write** | Add protobuf parsing for `prometheus.WriteRequest`. Customers with standard Prometheus setups can onboard with zero config changes to their existing remote_write setup |
| 2.6 | **Unmapped metric feedback loop** | When a metric arrives that has no normalisation_map entry, write to `unmapped_metrics`. Expose via admin endpoint so product team can map it |

**Deliverable:** Customer adds 4 lines to prometheus.yml. Within 5 minutes of first push, clusters appear in the dashboard. Within 15 minutes (after 100+ samples), baselines seed and analyzers start producing verdicts.

---

### Phase 3: Multi-tenant production readiness

**Goal:** 10+ customers can be onboarded without touching the server.

| # | What | Details |
|---|------|---------|
| 3.1 | **Tenant registration API** — `POST /tenants` | Creates tenant, stack, issues ingest token. Returns token to customer (only time it's shown in plaintext) |
| 3.2 | **Per-tenant rate limiting** | One tenant can't saturate the ingest endpoint for others. Limit: 10,000 samples/minute per tenant. Return `429` with `Retry-After` header |
| 3.3 | **Async analyzer queue** — replace in-memory with Redis Streams | At 10+ customers, in-memory queue loses state on restart and has no backpressure. Redis Streams adds persistence, consumer groups, and dead-letter handling |
| 3.4 | **Ingest token rotation** | `POST /ingest/tokens/rotate` — issues new token, old token valid for 24h grace period. Required for security compliance |
| 3.5 | **Pull + push coexistence per stack** | A tenant can have one stack in pull mode (Grafana API key) and another in push mode (ingest token). No code changes to intelligence pipeline |
| 3.6 | **Baseline staleness detection** | Baselines older than 30 days are automatically re-seeded from the last 30 days of received metrics. Cluster behavior drift is handled |

---

### Phase 4: Scale and reliability

**Goal:** 100 customers, 1,000+ clusters, SLA-grade uptime.

| # | What | Details |
|---|------|---------|
| 4.1 | **Analyzer worker pool** — Celery or separate process pool | Single-process asyncio can't saturate a CPU across 1,000 concurrent cluster analyses. Worker pool with configurable concurrency |
| 4.2 | **OTEL ingest support** | `application/otlp+proto` content type. Customers using OpenTelemetry Collector as their metrics pipeline (growing segment) can onboard without Prometheus |
| 4.3 | **Datadog Agent wire protocol** | Customers who are Datadog-first and don't run Prometheus can configure their Datadog Agent to forward to our ingest endpoint using the Datadog metrics API format |
| 4.4 | **Multi-region ingest** | EU customers need data to stay in EU. Ingest endpoints in `us-east1`, `eu-west1`, `ap-southeast1`. Intelligence pipeline runs in the same region as ingest |
| 4.5 | **Audit log** | Every verdict, every LLM call, every status change — immutable audit trail per tenant. Required for enterprise compliance (SOC2) |

---

## 7. What stays the same

These components require **no changes** for push to work:

| Component | Why unchanged |
|-----------|---------------|
| `analyzers/` (all files) | Already take `dict[str, float]` — completely source-agnostic |
| `baseline/engine.py` | Same statistical math regardless of how metrics arrived |
| `models/models.py` — `verdicts`, `verdict_evidence`, `llm_explanations` | Append-only verdict storage is source-agnostic |
| `runner/llm_explainer.py` | Fires on `VerdictResult` — doesn't know about data source |
| `api/routes/dashboard.py` | Reads from verdicts table — agnostic to how they got there |
| All existing tests | Analyzers are already tested with mock dicts |

This is the most important design property of the current architecture:
**the intelligence layer is already decoupled**. Push does not touch it.

---

## 8. Migration: pull → push for existing clusters

Existing Alpha clusters (ES + MySQL) run in pull mode today. They keep running
in pull mode indefinitely — no forced migration.

When a customer who also runs Prometheus configures remote_write:
- Push ingest receives metrics for the same cluster
- If cluster already exists in DB (pull mode), ingest recognises it by `cluster_id` label
- Both pull and push can coexist — the analyzer runs on whichever metric dict arrives first
- Duplicate analysis within the same 5-minute window is idempotent (same verdict)

No forced cutover. No downtime. Customers migrate at their own pace.

---

## 9. What a customer sees (the product experience)

### Day 0 — Signup
Customer creates account. Platform issues:
- `tenant_id`
- `ingest_token` for their first stack
- Setup instructions (4 lines of prometheus.yml)

### Day 0 + 5 minutes — First push arrives
Dashboard shows new clusters appearing in `unknown` state.
"We've detected 12 clusters. Baselines will be ready in approximately 15 minutes."

### Day 0 + 20 minutes — Baselines seeded
First verdicts appear. All clusters show `healthy` or `unknown`.
Analyzers are now running automatically every 5 minutes.

### Day 1 — Trust is built
Customer sees: "JVM heap pressure elevated above baseline on node-3" with a 
plain-English explanation of why, what the baseline was, and what to do.
No alert configuration. No threshold tuning. It just works.

### Day 7 — First incident caught early
A cluster shows `degraded` 40 minutes before it would have triggered a Grafana alert.
The SRE sees it, acts, prevents the incident. This is the moment the product earns its value.

### Day 30 — Expansion
Customer adds a second team's clusters. They create a new stack, get a new ingest token,
add 4 lines to their prometheus.yml. New clusters appear automatically.

---

## 10. Files to create / modify

### New files

| File | Purpose |
|------|---------|
| `backend/app/api/routes/ingest.py` | Push ingest endpoint — `POST /ingest/metrics` |
| `backend/app/ingest/normaliser.py` | Raw metric name → canonical name, derived metric computation |
| `backend/app/ingest/queue.py` | In-memory asyncio queue + worker pool (Phase 2) |
| `backend/app/scheduler/runner_scheduler.py` | Background task that runs all active clusters every N minutes (Phase 1) |
| `backend/migrations/versions/xxx_add_ingest_tokens.py` | Alembic migration for `ingest_tokens` table |
| `backend/scripts/issue_ingest_token.py` | CLI to create a tenant + stack + token (Phase 2 onboarding) |

### Modified files

| File | Change |
|------|--------|
| `backend/app/models/models.py` | Add `IngestToken` model |
| `backend/app/main.py` | Add scheduler lifespan task; register `/ingest` router |
| `backend/app/runner/analyzer_runner.py` | Extract `run_all_active_clusters()` — called by both scheduler and queue workers |
| `backend/app/api/routes/dashboard.py` | Add tenant_id scope to all queries |
| `backend/app/core/config.py` | Wire `analyzer_run_interval_seconds` to scheduler |

### Unchanged (by design)

```
backend/app/analyzers/           ← do not touch
backend/app/baseline/engine.py   ← do not touch
backend/app/models/models.py — verdicts, evidence, llm_explanations ← do not touch
```

---

## 11. Success metrics — how we know it's working

| Metric | Phase 1 target | Phase 2 target | Phase 3 target |
|--------|---------------|----------------|----------------|
| Analyzer runs | Manual → automatic every 5 min | Triggered by push within 30s | < 10s latency from push to verdict |
| Onboarding time | N/A (scripts) | < 15 min with docs | < 5 min self-serve |
| Tenant isolation | Not enforced | Enforced | Auditable |
| Customers supported | 1 | 5 | 100 |
| Clusters supported | 9 | 50 | 1,000+ |
| False positive rate | Unknown | < 10% | < 5% |
| Verdict coverage | 9 clusters | All push clusters | All clusters |

---

## 12. What NOT to build

- **Do not build a metrics storage layer.** We are not a time-series database.
  Raw metric values are normalised and discarded. Historical queries go back to
  the source system (Grafana, Prometheus). This is a hard constraint.

- **Do not build a proprietary agent.** Prometheus remote_write is the standard.
  Every customer already has it or can add it in minutes. A custom agent is a
  support burden and a security review blocker.

- **Do not rebuild the intelligence pipeline.** Analyzers, baselines, and the
  verdict model are the product's moat. Push is purely a data delivery mechanism.
  It must not change what the analyzers receive.

- **Do not enforce push-only.** Pull stays live for customers who prefer it.
  The choice is theirs.

---

## 13. Build order (summary)

```
Phase 1 (1–2 weeks) — Make what exists work reliably
  1.1 ingest_tokens table
  1.2 tenant-scoped queries
  1.3 automated scheduler
  ↓
Phase 2 (2–3 weeks) — Push ingest, simple JSON first
  2.1 POST /ingest/metrics (JSON)
  2.2 auto-discover clusters
  2.3 derived metrics at ingest
  2.4 baseline auto-seed
  2.5 Prometheus remote_write (protobuf)
  2.6 unmapped metric feedback
  ↓
Phase 3 (3–4 weeks) — Multi-tenant production
  3.1 tenant registration API
  3.2 rate limiting
  3.3 Redis queue
  3.4 token rotation
  ↓
Phase 4 (ongoing) — Scale
  4.1 worker pool
  4.2 OTEL support
  4.3 multi-region
```

**Start with Phase 1.3 (scheduler) — it's the highest-value single change.
The product currently goes blind between manual runs. Fix that first.**
