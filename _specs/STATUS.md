# DB Intelligence Platform — Session Status

> Claude Code: Read this file BEFORE reading the plan document.
> Update this file WHENEVER a step completes, something is discovered,
> or a session ends for any reason.

---

## Current status

**Phase:** Signal Correlation Analyzers — MySQL Connection Pool Patterns COMPLETE
**Plan documents:** `_specs/plan-master.md` + `_specs/plan-master-v2.md`
**Last updated:** April 14 2026 — End of session
**Branch:** `feat/push-ingest-architecture`

---

## What was completed this session

### 1. Connection Pool Saturation Analyzer — Pattern Classification
Complete rewrite of `backend/app/analyzers/mysql/connection_pool_saturation.py`.
Three patterns now classified using corroborating signals:

| Pattern | Signal signature | Root cause text |
|---------|-----------------|-----------------|
| LEAK | connections high, threads_running < 15% of connections, slow query rate flat | App not returning connections to pool |
| PILE-UP | connections high, slow_query_rate ≥ 0.5/s, threads sigma elevated | Slow queries holding connections open |
| SURGE | connections high, query_rate sigma > 1.5, threads proportional | Genuine traffic increase |

### 2. Derived metrics for push ingest
`backend/app/ingest/derived.py` — two new rules added:
- `mysql.slow.queries.total / 300` → `mysql.slow.query.rate` (5-min window → per-second rate)
- `mysql.queries.total / 300` → `mysql.query.rate`

Push payloads now produce 17 canonical metrics (was 15). Enables pattern classification
for push-ingest clusters without needing PromQL irate().

### 3. BaselineProfile.is_valid bug fixed
`backend/app/models/models.py` — added `is_valid` property to `BaselineProfile` ORM model.
Previously, `getattr(baseline, "is_valid", False)` always returned False for DB-fetched
baselines (property only existed on `BaselineResult` in-memory class). This caused all
analyzers to fall back to absolute thresholds and report "no baseline yet" even when
baselines existed in the DB.

### 4. Sim cluster baselines seeded
New script: `backend/scripts/seed_sim_baselines.py`
Seeds synthetic baseline profiles for `Sim|us-east1|mysql_connpool_sim` using normal
scenario values (52% connections, 11 threads, 0.05 slow/s, 1020 q/s). Writes 48
baseline profiles across 5 window types.

### 5. Simulator working end-to-end
`backend/scripts/simulate_connpool.py` — all three scenarios verified in UI:
- LEAK: "169 connections, only 5 threads active (3% utilization)" → connection leak verdict
- PILE-UP: "slow query rate 1.21/s, 20 active threads" → slow query pile-up verdict
- SURGE: "1411/s vs 1020/s baseline" → genuine traffic surge verdict

Ingest token: `dbi_B3kcu9hWdKwiRqY4N8kLCrGHuDXg-qZM`
Cluster: `Sim|us-east1|mysql_connpool_sim`

### 6. Replication lag / latency UI bug fixed
`backend/app/api/routes/dashboard.py`:
- MySQL "latency" card now shows actual query latency from performance_schema
- Replication lag moved to separate `replicationLagMs` field
- Added `mysql.query.latency.ms` and `mysql.query.rate` to `_MYSQL_LIVE_METRICS`

`src/pages/DatabaseDetailPage.tsx`:
- MySQL detail page shows "Repl Lag" card with correct thresholds (warn=10s, critical=60s)
- ES keeps "Latency" card with query latency thresholds

### 7. 63 tests for connection pool saturation
`backend/tests/test_analyzers/test_connection_pool_saturation.py` — 63 tests covering:
all three patterns, healthy state, no baseline, log signals, status boundaries, can_run,
evidence chain. All pass.

### 8. AI chat panel fixed — now calls backend directly
`src/components/features/database-detail/ClusterAIPanel.tsx`:
- Was calling `generateAISummary()` which generated a fleet-wide prompt ignoring cluster context
- Now calls `POST /ai/chat` directly with full cluster system prompt
- System prompt enriched with full evidence chain: sigma scores, baseline p50/p95, pattern analysis, related metrics per issue
- Graceful error message when Anthropic API quota exceeded

**BLOCKER: Anthropic API credits exhausted** — AI chat shows error until credits topped up.
Top up at: console.anthropic.com → Billing
The analyzer verdicts (WHY THIS IS HAPPENING / WHAT TO DO) are unaffected — they don't call the API at runtime.

### 9. Grafana adapter — two new MySQL custom queries
`backend/app/adapters/grafana_cloud/adapter.py`:
- `mysql.query.rate` — irate of total queries/sec
- `mysql.query.latency.ms` — avg execution time per query in ms

---

## Uncommitted files (need to be committed)

| File | Status | Notes |
|------|--------|-------|
| `backend/app/runner/analyzer_runner.py` | Modified | Adds disk_watermark, fielddata_circuit_breaker, mysql_disk_space to registry |
| `backend/app/analyzers/elasticsearch/disk_watermark.py` | Untracked | Complete, wired in, no tests |
| `backend/app/analyzers/elasticsearch/fielddata_circuit_breaker.py` | Untracked | Complete, wired in, no tests |
| `backend/app/analyzers/mysql/disk_space.py` | Untracked | Complete, wired in, no tests |
| `backend/app/models/models.py` | Modified | is_valid property on BaselineProfile |
| `backend/app/ingest/derived.py` | Modified | slow.query.rate and query.rate derived rules |
| `backend/app/api/routes/dashboard.py` | Modified | replicationLagMs field, query.latency.ms |
| `backend/scripts/seed_sim_baselines.py` | Untracked | New script |
| `backend/scripts/simulate_connpool.py` | Untracked | New script |
| `backend/tests/test_analyzers/test_connection_pool_saturation.py` | Untracked | 63 tests |
| `src/components/features/database-detail/ClusterAIPanel.tsx` | Modified | Direct backend call, enriched system prompt |
| `src/pages/DatabaseDetailPage.tsx` | Modified | Repl lag card |

---

## Build sequence progress

| Step | Description | Status | Notes |
|------|-------------|--------|-------|
| 1 | Discovery — Grafana Cloud queries | Complete | |
| 2 | Database schema and migrations | Complete | |
| 3 | Adapter interface and configuration | Complete | |
| 4 | Baseline seeder | Complete | |
| 5 | Analyzer runner | Complete | |
| 6 | Verdict writer | Complete | |
| 7 | Shard allocation failure analyzer | Complete | |
| 8 | Thread pool saturation analyzer | Complete | |
| 9 | Frontend API client | Complete | |
| 10 | Internal admin views (unmapped metrics) | Not started | |
| 11 | End-to-end integration test | Not started | |

### Analyzers complete

| Analyzer | File | Tests | Status |
|----------|------|-------|--------|
| JVM Heap Pressure | `elasticsearch/jvm_heap_pressure.py` | 21/21 | Committed, live |
| Shard Allocation Failure | `elasticsearch/shard_allocation.py` | 0 | Committed, live |
| Thread Pool Saturation | `elasticsearch/thread_pool_saturation.py` | 0 | Committed, live |
| Disk Watermark | `elasticsearch/disk_watermark.py` | 0 | **Untracked** |
| Fielddata Circuit Breaker | `elasticsearch/fielddata_circuit_breaker.py` | 0 | **Untracked** |
| Connection Pool Saturation | `mysql/connection_pool_saturation.py` | 63/63 | Committed, live, pattern classification working |
| Replication Lag | `mysql/replication_lag.py` | 0 | Committed, live |
| InnoDB Buffer Pool Pressure | `mysql/innodb_buffer_pool_pressure.py` | 0 | Committed, live, per-instance |
| Disk Space | `mysql/disk_space.py` | 0 | **Untracked** |

---

## Next session — recommended actions (priority order)

1. **Top up Anthropic credits** — AI chat panel is blocked until this is done
2. **Commit all uncommitted files** — 3 new analyzers + all bug fixes from this session
3. **Write tests** for disk_watermark, fielddata_circuit_breaker, mysql_disk_space (follow test_connection_pool_saturation.py pattern)
4. **Step 10** — Internal admin views for unmapped_metrics table
5. **Step 11** — End-to-end integration test
6. **Next MySQL analyzer** — tmp table overflow or write amplification (see memory/project_signal_correlation_design.md)

---

## How to run things

```bash
# Backend (from backend/ directory)
PYTHONPATH=/Users/mgutha/Desktop/dbhealth-app/db-intelligence-platform/backend \
  /Users/mgutha/Desktop/dbhealth-app/db-intelligence-platform/backend/.venv/bin/uvicorn \
  app.main:app --host 0.0.0.0 --port 8000

# Push simulator
PYTHONPATH=... .venv/bin/python scripts/simulate_connpool.py \
  --token dbi_B3kcu9hWdKwiRqY4N8kLCrGHuDXg-qZM --scenario leak

# Seed sim baselines (run once after resetting DB)
PYTHONPATH=... .venv/bin/python scripts/seed_sim_baselines.py

# Tests
PYTHONPATH=... .venv/bin/pytest tests/test_analyzers/test_connection_pool_saturation.py -v

# Frontend (from project root)
npm run dev
```

---

## Live clusters

| Cluster | DB Type | Status | Notes |
|---------|---------|--------|-------|
| els_shrdegt_alpha_va | ES | good | |
| els_shrdone_alpha_va | ES | good | |
| els_shrdsix_alpha_va | ES | good | |
| els_shrdsvn_alpha_va | ES | warning | JVM heap pressure |
| els_sixna_alpha_va | ES | warning | JVM heap pressure |
| mysql_aa_alpha | MySQL | live | Per-instance InnoDB verdicts |
| mysql_bigaa_alpha | MySQL | live | Per-instance InnoDB verdicts |
| mysql_mng_alpha | MySQL | live | Per-instance InnoDB verdicts |
| mysql_sharedaa_alpha | MySQL | live | Per-instance InnoDB verdicts |
| mysql_connpool_sim | MySQL | sim | Push ingest, baselines seeded, all 3 patterns verified |

