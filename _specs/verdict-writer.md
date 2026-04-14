# Verdict Writer — Status Change Detection and LLM Trigger

**Spec file:** `_specs/verdict-writer.md`  
**Branch:** `claude/feature/verdict-writer`  
**Status:** Draft  
**Created:** April 2026  
**Author:** Internal

---

## 1. Overview

The verdict writer is the component that receives a structured `VerdictResult` from an analyzer worker, detects whether the status has changed since the last run, persists the verdict to the database, and triggers the LLM explanation layer only when a status change is detected. It is the boundary between the deterministic analysis layer and the plain-English explanation layer.

---

## 2. Context & Motivation

Analyzers produce verdicts on every run. Without the verdict writer, there is no persistence, no status change detection, and no LLM triggering logic. It is the most critical missing backend component — nothing flows from the analyzer engine to the UI without it.

The LLM must only be called when status changes (e.g. healthy → degraded, degraded → critical, critical → healthy). Calling it on every run would produce unnecessary cost at scale and violate the "LLM on status change only" product principle.

**Persona(s) affected:**
- [x] On-call engineer (incident response) — sees verdicts in UI during incidents
- [x] Database administrator (daily health check) — sees verdict history and trends
- [ ] Engineering manager (fleet overview)
- [ ] Platform engineer (100+ clusters)

**Product principle this touches:**
- [x] Advisory-first (recommendations, never automation)
- [ ] Read-only and push-based
- [x] Deterministic analyzers find the truth (LLM explains only)
- [ ] No raw data storage
- [ ] Insight over metrics

---

## 3. User Stories

**Primary story:**
> As an on-call engineer, I want the platform to show me a plain-English explanation of what changed and why, the moment a cluster moves from healthy to degraded, so I can act immediately without reading raw metrics.

**Supporting stories:**
> As a database administrator, I want to see a history of verdict status changes for each cluster, so I can identify patterns and recurring failure modes over time.
> As a platform engineer, I want the system to call the LLM only when something actually changes, so the platform remains cost-efficient at fleet scale.

---

## 4. Scope

### In scope
- Receiving a `VerdictResult` from an analyzer worker
- Fetching the most recent verdict for this cluster + analyzer combination
- Detecting whether status has changed
- Writing the new verdict to the `verdicts` table (append-only)
- Writing individual evidence items to `verdict_evidence`
- Triggering LLM explanation generation when status changes
- Storing the LLM explanation in `llm_explanations`
- Updating `clusters.current_status` after writing the verdict

### Out of scope
- The analyzer runner (separate spec — runs analyzers and calls the verdict writer)
- The LLM explanation service internals (handled by the LLM layer)
- Notification or alerting when status changes (future spec)
- Verdict deletion or mutation (verdicts are append-only — never in scope)

---

## 5. Functional Requirements

| Requirement | Priority | Notes |
|-------------|----------|-------|
| Accept a structured VerdictResult and persist it to the verdicts table | Must Have | Append-only — never update existing rows |
| Persist each evidence item to verdict_evidence | Must Have | Preserves the full evidence chain |
| Set prev_status on the new verdict row | Must Have | Required for status change detection and LLM trigger logic |
| Detect status change by comparing new status to the most recent verdict for this cluster + analyzer | Must Have | Query verdicts table ordered by run_at desc, limit 1 |
| Trigger LLM explanation when status changes | Must Have | Must not trigger on every run — only on status change |
| Store LLM explanation in llm_explanations linked to the verdict | Must Have | Permanent storage — postmortem reads history |
| Update clusters.current_status to the worst status across all active analyzers after writing | Must Have | Keeps overview page stats accurate |
| Handle the case where no previous verdict exists (first run) | Must Have | Treat as a status change from unknown — trigger LLM |
| Log LLM input token and output token counts for cost tracking | Should Have | Stored on llm_explanations.input_tokens / output_tokens |
| Handle LLM failure gracefully — verdict is still written even if LLM call fails | Must Have | LLM is non-critical path — verdict persistence is primary |
| Retry LLM call once on transient failure before giving up | Should Have | Simple retry with short backoff |

---

## 6. UX & Interaction Design

The verdict writer is a backend component — it has no direct UI. Its output appears in the UI as:

- Updated cluster status badge on the overview page
- New verdict entry on the cluster detail page
- LLM explanation text shown below the verdict on the cluster detail page
- Freshness state updated to "fresh" after a successful run

**Figma reference:** Not applicable — backend component

**Design notes:**
- The UI must never show a verdict without its freshness state — the three-timestamp model (metric_ts, ingested_at, run_at) must all be populated before display
- If the LLM explanation is not yet available (e.g. still generating), the UI shows a loading indicator in the explanation panel rather than blocking the verdict display

---

## 7. Data & Backend Considerations

**Data this feature reads:**
- `verdicts` table — most recent verdict for cluster + analyzer (to detect status change)
- `clusters` table — current_status for update after verdict write

**Data this feature writes:**
- `verdicts` table — new row per analyzer run (append-only, never update)
- `verdict_evidence` table — one row per evidence item in the VerdictResult
- `llm_explanations` table — one row on status change, linked to the new verdict
- `clusters.current_status` — updated to worst status across all analyzers

**API endpoints involved:**
- No new external endpoint — the verdict writer is an internal service called by the analyzer runner
- It calls the Anthropic API internally to generate LLM explanations

**Does this touch the data plane / control plane boundary?**
- [x] Yes — the verdict writer runs on the control plane. It receives verdicts that crossed the boundary from the data plane. It must only receive structured verdict fields — not raw metric values. This is enforced by the VerdictResult schema.

**Analyzer / verdict involvement:**
- [x] This feature writes verdicts — it must follow the append-only pattern. No UPDATE statements on the verdicts table ever.
- [x] This feature triggers the LLM — it must only trigger on status change. The condition: `new_status != prev_status` or `prev_status is None`.

---

## 8. Non-Functional Requirements

| Requirement | Target | Notes |
|-------------|--------|-------|
| Verdict write latency | < 200ms for DB write (excluding LLM) | LLM call is async and non-blocking for verdict persistence |
| LLM call timeout | 30 seconds max | If exceeded, log the failure and move on — verdict is already written |
| Concurrent writes | Must handle multiple clusters writing verdicts simultaneously | Use async SQLAlchemy — no global locks |
| Append-only enforcement | Zero UPDATE statements on verdicts table | Enforced by code review — never add an update path |
| Cost guardrail | LLM called on status change only | Monitored via token count logging on llm_explanations |

---

## 9. Open Questions

| Question | Owner | Needed by |
|----------|-------|-----------|
| What LLM system prompt structure produces the best plain-English explanations from a structured verdict? | Engineering | Phase 1 — before building the LLM trigger |
| Should the LLM explanation be generated synchronously (blocking the verdict write response) or queued asynchronously? | Engineering | Phase 1 — affects the analyzer runner design |
| What happens to clusters.current_status if only one analyzer is critical but others are healthy — is it critical or a per-analyzer status? | Engineering | Phase 1 — affects overview page accuracy |

---

## 10. Acceptance Criteria

- [ ] Given an analyzer produces a healthy verdict for a cluster that was previously degraded, when the verdict writer processes it, then a new verdict row is written with status=healthy and prev_status=degraded
- [ ] Given a status change is detected, when the verdict writer processes it, then an LLM explanation is generated and stored in llm_explanations within 30 seconds
- [ ] Given a status change is NOT detected (same status as previous verdict), when the verdict writer processes it, then the LLM is NOT called
- [ ] Given no previous verdict exists for a cluster + analyzer pair, when the verdict writer processes the first result, then it is treated as a status change and the LLM is triggered
- [ ] Given the LLM API returns an error, when the verdict writer encounters it, then the verdict is still persisted successfully and the error is logged
- [ ] Given multiple clusters produce verdicts concurrently, when the verdict writer processes them, then each verdict is persisted independently without data corruption
- [ ] Given a verdict is written, then clusters.current_status reflects the worst status across all analyzers for that cluster
- [ ] All existing backend tests continue to pass
- [ ] The three timestamps (metric_ts, ingested_at, run_at) are all populated correctly on every verdict row

---

## 11. Dependencies

**Depends on (must be built first):**
- `verdicts` table schema — already exists
- `verdict_evidence` table schema — already exists
- `llm_explanations` table schema — already exists
- `jvm_heap_pressure` analyzer — already built (needed to produce VerdictResult for testing)
- Anthropic Claude API credentials configured in environment

**Blocks (cannot be built until this is done):**
- Analyzer runner spec — the runner calls the verdict writer after each analyzer completes
- Frontend API client spec — the UI needs real verdicts to display

---

## 12. Related Specs

- `_specs/analyzer-runner.md` — the worker that runs analyzers and calls this component
- `_specs/frontend-api-client.md` — consumes the verdicts this component writes

---

*DB Intelligence Platform — Internal use only*
