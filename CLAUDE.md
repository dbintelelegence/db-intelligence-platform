# DB Intelligence Platform — Claude Code Rules

This file is read automatically by every Claude Code command in this
repo. These rules apply to all tasks, all commands, all sessions.

---

## Filesystem safety — read this first

**Never delete, move, or modify anything outside this project
directory or its virtual environment.**

Allowed work areas:
```
db-health/               ← project root, all work happens here
db-health/.venv/         ← Python virtual environment
db-health/node_modules/  ← frontend dependencies
```

Never touch:
```
~/Documents, ~/Downloads, ~/Desktop or any other home directory
/Users/ — any other user files
/etc/   — system configuration
/usr/   — system binaries
/var/   — system data
Any absolute path not inside this project root
```

If a task requires deleting or moving files, only operate on
files inside the project directory. If uncertain whether a path
is safe — ask before acting.

Never run:
- rm -rf on any path outside the project directory
- sudo or su commands of any kind
- chmod or chown on system paths
- Any command that modifies files in other projects or system state

---

## What this product is

An intelligence layer that sits above existing monitoring platforms
(Grafana, Datadog, New Relic) and produces evidence-backed,
design-aware verdicts about why databases behave poorly.

We do not collect metrics. We read what the customer already has.
We do not replace Grafana or Datadog. We explain what they cannot.

---

## The one principle that overrides everything else

Deterministic analyzers find the truth. The LLM explains the truth.

The LLM never diagnoses. Analyzers produce structured verdicts.
The LLM converts them to plain English on status change only.

---

## Hard constraints — never violate these

| Constraint | Rule |
|------------|------|
| Advisory-first | Never write code that modifies, restarts, or reconfigures a customer database |
| Read-only | Only GET/read calls on customer infrastructure. Never POST/PUT/DELETE |
| No LLM in analyzers | LLM calls belong only in the verdict writer, triggered by status change |
| LLM on status change only | Always check new_status != prev_status before calling LLM |
| No raw metrics storage | Metric values held in memory only. Baselines and verdicts persisted. |
| Append-only verdicts | Never UPDATE the verdicts table. Always INSERT a new row. |
| Engine abstraction | Never hardcode Elasticsearch outside ES-specific modules. |
| Tenant isolation | Every database query must include a tenant_id filter. No exceptions. |
| No stack exposure | Stack concept is internal only. Never appears in API responses or UI. |

---

## Architecture — three layers

Layer 1 — Presentation: React frontend + FastAPI REST API
  Customer sees: database names, health, verdicts
  Customer never sees: source type, stack, normalisation

Layer 2 — Intelligence: Baseline engine → Analyzers → Metadata enrichment
  → Verdict writer → LLM explanation
  Operates on canonical schemas only

Layer 3 — Ingestion: Source adapters + Normalisation maps + Stacks
  Internal only — never exposed to customer

Layer 1 never talks to Layer 3 directly. This boundary is sacred.

---

## Intelligence pipeline

Metrics (mandatory) ──► Analyzers ──► [Metadata enrichment] ──► Verdicts ──► LLM
Log signals (opt)   ──►              (only if present,          (always)    (status
Metadata (opt)      ──►               never blocks)                          change)

Metrics are the only hard requirement. Everything else is additive.
The verdict is always written regardless of which layers are present.

---

## Analyzer pattern — all analyzers follow this exactly

ANALYZER_NAME = "failure_mode_name"   # one failure mode, not one metric
DB_TYPE = "elasticsearch"
PRIMARY_METRICS = [...]        # missing = analyzer cannot run
CORROBORATING_METRICS = [...]  # missing = confidence drops
OPTIONAL_LOG_SIGNALS = [...]   # missing = confidence ceiling lower

def analyze(self, metrics, baselines, log_signals={}, metric_ts=None):
    # Use sigma scores against baselines — not absolute thresholds
    # Return VerdictResult — never call LLM here
    # Use canonical metric names only — never raw source names

Wrong: CPU Analyzer, Heap Analyzer, Disk Analyzer
Right: JVM Heap Exhaustion Analyzer, Shard Allocation Failure Analyzer

---

## Confidence scoring rules

PRIMARY metrics missing         → analyzer does not run
CORROBORATING metrics missing   → confidence ceiling drops
All primary + corroborating     → MEDIUM base confidence
Log signal corroborates         → +1 level
Metadata confirms hypothesis    → +1 level
No baseline yet (< 100 samples) → LOW regardless
Log signal contradicts          → -1 level
Maximum: HIGH   Minimum: LOW

---

## Normalisation — per source type

Metric names vary by exporter. The same metric arrives differently:
  elasticsearch_jvm_memory_heap_used_percent  (Prometheus exporter)
  elasticsearch.jvm.mem.heap_used_percent     (Datadog)

Normalisation map lives in the database — not a hardcoded dict.
Product team updates it without deployment.
Unmapped metrics go to unmapped_metrics table — never silently dropped.

---

## Stack model (internal only, never exposed)

Stack = one engine + one source system + one customer
Customer sees only: database names and health status

---

## What is built and working

### Backend
backend/app/models/models.py                                         schema + migrations complete
backend/app/schemas/schemas.py                                        complete
backend/app/baseline/engine.py                                        complete
backend/app/adapters/grafana_cloud/adapter.py                         live, all 9 metrics, CUSTOM_QUERIES for CPU
backend/app/analyzers/elasticsearch/jvm_heap_pressure.py             21/21 tests, live
backend/app/analyzers/elasticsearch/shard_allocation.py              live
backend/app/analyzers/elasticsearch/thread_pool_saturation.py        live
backend/app/baseline/seeder.py                                        live, --all-alpha flag
backend/app/runner/analyzer_runner.py                                 live, --all-alpha flag, LLM on status change
backend/app/runner/llm_explainer.py                                   live, Claude Haiku via Anthropic API
backend/app/api/routes/dashboard.py                                   /dashboard/summary — live metrics, UUID IDs
backend/app/api/routes/ai.py                                          /ai/chat — Anthropic proxy endpoint
backend/scripts/seed_normalisation.py                                 seeds tenant, stack, normalisation_map
backend/scripts/seed_alpha_clusters.py                                seeds all 5 Alpha ES clusters

### All 5 Alpha clusters live
els_shrdegt_alpha_va — good
els_shrdone_alpha_va — good
els_shrdsix_alpha_va — good
els_shrdsvn_alpha_va — warning (JVM heap pressure)
els_sixna_alpha_va   — warning (JVM heap pressure)

### Frontend
src/pages/OverviewPage.tsx          live data, skeleton loading, clickable stat strip navigation
src/pages/DatabaseDetailPage.tsx    live data, spinner while loading (no "not found" flash)
src/pages/DatabasesPage.tsx         live data, status filter (?status=healthy|attention)
src/hooks/useDashboard.ts           fetches /dashboard/summary, empty during load (no mock flash)
src/components/layout/CommandPalette.tsx   Cmd+K search
src/components/features/database-detail/ClusterAIPanel.tsx   AI chat via backend proxy
src/components/features/summarization/ChatInterface.tsx       markdown rendering

---

## What is not built yet — build in this order

Always check _specs/STATUS.md before starting any work.

1. Internal admin views (unmapped metrics table)
2. End-to-end integration test
9. Internal admin views (unmapped metrics)

---

## Do not touch these files

backend/app/analyzers/elasticsearch/jvm_heap_pressure.py
backend/app/analyzers/base.py
backend/app/baseline/engine.py
backend/app/schemas/schemas.py

These are tested and correct. Changes require explicit instruction.

---

## Planning documents

_specs/plan-master.md    Full architecture and build sequence
_specs/STATUS.md         Session state — read this first every session
_specs/template.md       Spec template for /feature-spec command

---

## Current prototype scope

Engine: Elasticsearch only
Source systems: Grafana Cloud + Datadog
Customer profile: Mid-size, 50+ databases, GCP + self-hosted
Input layers: Metrics only (logs and metadata are future phases)
Auth: Deferred — must be compatible with Auth0 + SAML when added

MySQL is Phase 2. Do not build MySQL components in this phase.