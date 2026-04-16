# Real Metric Trend Chart

**Spec file:** `_specs/real-metric-trend-chart.md`  
**Branch:** `claude/feature/real-metric-trend-chart`  
**Status:** Updated — UX recommendations incorporated  
**Created:** 2026-04-15  
**Author:** Murali Gutha

---

## 1. Overview

The issue detail panel in `DatabaseDetailPage` currently shows a "Metric trend (last 24h)" sparkline that is generated from random noise seeded off the current single live metric value. The chart shows the wrong metric for most issue types (e.g. CPU trend for a circuit breaker issue), the dashed baseline lines are never rendered despite the label saying they exist, and there are no axis labels so the user cannot interpret the values. This feature replaces the fake chart with a real time-series built from stored verdict history, plots the correct primary metric per issue type, and renders real p50/p95 baseline reference lines from the `baseline_profiles` table — giving the on-call engineer an honest answer to "how long has this been bad and what is normal?".

---

## 2. Context & Motivation

An on-call engineer opening an issue card needs to answer three questions immediately:
1. Is this getting worse or stabilising?
2. How far outside normal is the current value?
3. How long has it been in this state?

The current chart answers none of these — it is cosmetic noise. The data to answer all three already exists in the database (`verdicts.observed` contains the metric values timestamped by `metric_ts`; `baseline_profiles` contains p50/p95 for every canonical metric per cluster). This feature exposes what is already there.

This also directly violates the product principle "Insight over metrics — explain state, don't chart raw data" in its current form: showing a fake chart is worse than showing no chart because it implies false confidence.

**Persona(s) affected:**
- [x] On-call engineer (incident response)
- [x] Database administrator (daily health check)
- [ ] Engineering manager (fleet overview)
- [ ] Platform engineer (100+ clusters)

**Product principle this touches:**
- [x] Advisory-first (recommendations, never automation)
- [ ] Read-only and push-based (no infrastructure access)
- [x] Deterministic analyzers find the truth (LLM explains only)
- [ ] No raw data storage (baselines and verdicts only)
- [x] Insight over metrics (explain state, don't chart raw data)

---

## 3. User Stories

**Primary story:**
> As an on-call engineer, I want to see how the triggering metric has trended over the last 24 hours with the normal range clearly marked, so that I can immediately judge whether the problem is new, worsening, or stabilising without leaving the platform.

**Supporting stories:**
> As an on-call engineer, I want the chart to show the metric that actually caused the alert (e.g. `circuit_breaker.tripped` for a circuit breaker issue, not CPU), so that the trend is directly relevant to the verdict I am reading.

> As a database administrator, I want to see the baseline p50 and p95 as labelled reference lines on the chart, so that I can see precisely how far the current value deviates from what is normal for this cluster.

> As an on-call engineer, I want both axes to be labelled (time on x, metric value with units on y), so that I can understand the scale of the problem without guessing.

> As an on-call engineer, I want a clear visual marker showing when the issue first crossed the threshold, so I can immediately answer "how long has this been affecting users?" without reading timestamps.

> As an on-call engineer opening a new cluster for the first time, I want to know when the trend chart will be available, not just see a static placeholder.

---

## 4. Scope

### In scope
- New backend endpoint: `GET /verdicts/{cluster_id}/{analyzer_name}/trend?hours=24` — returns the last N verdict rows for this cluster+analyzer as a time series of the primary metric value, extracted from the verdict evidence, keyed by `metric_ts`
- Endpoint also returns `issue_started_at`: the earliest `run_at` where `status = current non-healthy status` (used to draw the onset marker)
- Endpoint returns `points_collected` count so the frontend can show progress toward the 3-point minimum
- Real baseline p50 and p95 fetched from `baseline_profiles` for the primary metric of each analyzer, returned alongside the time series
- Frontend chart updated to consume real data from the new endpoint
- Chart height: 120px in expanded card (was 56px decorative sparkline)
- X-axis: time labels (HH:mm for 24h window)
- Y-axis: numeric value with unit suffix (%, ms, count, MB)
- Data points rendered as visible dots on the line so the user can see exactly when each sample was taken
- Subtitle below chart: "Sampled every ~1 min (analyzer cadence)" — sets honest expectation
- Dashed reference lines at p50 and p95 with inline labels at right edge
- Vertical reference line at `issue_started_at` labelled "Issue started" — answers when customers were first affected
- Tooltip showing exact value + timestamp on hover
- Chart positioned below WHY THIS IS HAPPENING / WHAT TO DO columns, above RELATED METRICS
- Graceful empty state: if fewer than 3 data points exist, show progress message (e.g. "Chart available after 3 runs. 1 of 3 collected.") instead of a static placeholder

### Out of scope
- Fetching raw Grafana/Prometheus time-series directly (we plot verdict snapshots only — one point per analyzer run, not per-second telemetry)
- Interactive zoom or time range selection on the sparkline
- Exporting chart data
- Charts for healthy clusters (chart only appears on non-healthy issues)
- Multi-metric overlays (one metric per chart)

---

## 5. Functional Requirements

| Requirement | Priority | Notes |
|-------------|----------|-------|
| Chart shows the primary metric for the specific analyzer, not a generic CPU/memory proxy | Must Have | Each analyzer has one designated primary trend metric |
| Data points come from real verdict history keyed by `metric_ts` | Must Have | Replaces `metrics-time-series-generator.ts` entirely for issue cards |
| Chart height is 120px in expanded card | Must Have | 56px is too small once axes are added — actual plot area would be ~30px |
| Data points rendered as visible dots on the line | Must Have | Makes sample cadence visible; user can see when each reading was taken |
| Subtitle shows analyzer cadence ("Sampled every ~1 min") | Must Have | Prevents user from assuming continuous telemetry |
| Vertical "Issue started" marker at first non-healthy verdict `run_at` | Must Have | Answers the #1 on-call question: how long has this been happening |
| Chart positioned below WHY/WHAT TO DO, above RELATED METRICS | Must Have | Actions first; chart is supporting evidence not the headline |
| Disk analyzers use used % not available bytes | Must Have | Consistent upward trend direction with all other analyzers |
| Baseline p50 rendered as a dashed reference line labelled "p50" | Must Have | Sourced from `baseline_profiles` for the matching canonical metric + cluster |
| Baseline p95 rendered as a dashed reference line labelled "p95" | Must Have | Sourced from `baseline_profiles` |
| X-axis shows time labels at appropriate intervals | Must Have | HH:mm for 24h, date+time for 7d |
| Y-axis shows numeric values with unit suffix | Must Have | %, ms, count, or s depending on metric |
| Tooltip shows exact value and timestamp on hover | Should Have | |
| Empty state shows progress toward 3-run minimum | Must Have | "Chart available after 3 runs. 1 of 3 collected." — not a dead-end placeholder |
| Loading skeleton while data is fetching | Should Have | Matches existing skeleton pattern in the app |
| Chart degrades gracefully if the new endpoint is unavailable | Must Have | Falls back to hiding the chart section entirely, no error boundary crash |
| Existing issue card text (WHY THIS IS HAPPENING, WHAT TO DO, RELATED METRICS) is unchanged | Must Have | Regression guard |

---

## 6. UX & Interaction Design

**Figma reference:** Not provided

**Design notes:**
- Chart height: 120px (was 56px). At 56px with axes added, the actual plot area is ~30px — unreadable.
- **Position in expanded card** (top to bottom): WHY THIS IS HAPPENING + WHAT TO DO columns → chart → RELATED METRICS. Chart is supporting evidence, not the headline.
- X-axis sits below the line, Y-axis sits to the left — both use `text-muted-foreground` at 10px
- Data points rendered as small dots (r=3) on top of the line — makes the sample cadence visible
- Subtitle below chart title: "Sampled every ~1 min (analyzer cadence)" in 10px muted text
- p50 dashed line: subtle grey (`hsl(var(--muted-foreground))`, 40% opacity), labelled "p50" at right edge
- p95 dashed line: amber (`#f59e0b`, 50% opacity), labelled "p95" at right edge — signals "above here is abnormal"
- Vertical "Issue started" line: red/amber (matches severity), dashed, labelled "Issue started" at top — positioned at the earliest `run_at` where status = current non-healthy status
- The trend line keeps its existing severity colour (red for critical, amber for warning)
- Chart header: "Metric trend (last 24h) · `<canonical_metric_name>`"
- The chart only appears in the expanded card — no change to collapsed state
- On very narrow screens (< 400px), axis labels are hidden but reference lines and dots remain
- Empty state (< 3 points): show "Chart available after 3 analyzer runs. X of 3 collected." with a subtle progress indicator

**Entry points:**
- User clicks an issue card header to expand it — WHY/WHAT TO DO renders first, chart below

**Exit points:**
- No navigation — chart is read-only contextual information within the card

---

## 7. Data & Backend Considerations

**Data this feature reads:**
- `verdicts` table — `metric_ts`, `run_at`, `analyzer_name`, `cluster_id`, `status`, `observed` (evidence values are extracted from the evidence items via the `verdict_evidence` join)
- `verdict_evidence` table — `evidence_text` and `source_type=metric` rows contain the raw metric value strings (e.g. `fielddata.memory.bytes=413.2 MB`) — value is parsed out
- `baseline_profiles` table — `p50`, `p95`, `canonical_metric_name`, `cluster_id`, `window_type=all` for the primary metric of the requested analyzer

**Data this feature writes:**
- None. Read-only.

**API endpoints involved:**
- New endpoint needed: `GET /verdicts/{cluster_id}/{analyzer_name}/trend`
  - Query params: `hours` (default 24), `metric` (canonical metric name to extract — defaults to the analyzer's primary metric)
  - Response: `{ points: [{ts: ISO8601, value: float}], baseline: {p50: float, p95: float}, unit: string, metric_name: string, issue_started_at: ISO8601 | null, points_collected: int }`
  - `issue_started_at`: earliest `run_at` where status equals the current non-healthy status (for the "Issue started" vertical marker)
  - `points_collected`: total verdict rows in the requested window (used to show progress in empty state)
  - Tenant isolation: `cluster_id` is a UUID; endpoint must verify the cluster belongs to the resolved tenant before returning data

**Does this touch the data plane / control plane boundary?**
- [x] No — purely reads from the verdict/baseline control plane. No adapter calls, no Grafana queries.

**Analyzer / verdict involvement:**
- [x] This feature reads verdicts — all analyzers that produce non-healthy issues: `jvm_heap_pressure`, `shard_allocation_failure`, `thread_pool_saturation`, `fielddata_circuit_breaker`, `disk_watermark`, `mysql_connection_pool_saturation`, `mysql_replication_lag`, `mysql_innodb_buffer_pool_pressure`, `mysql_disk_space`
- [ ] This feature writes verdicts
- [ ] This feature triggers the LLM
- [ ] Not applicable

**Primary metric per analyzer (drives which metric is extracted and which baseline is fetched):**

| Analyzer | Primary trend metric | Unit |
|----------|---------------------|------|
| `jvm_heap_pressure` | `jvm.heap.used.percent` | % |
| `shard_allocation_failure` | `shard.unassigned.count` | count |
| `thread_pool_saturation` | `thread_pool.write.queue` | count |
| `fielddata_circuit_breaker` | `circuit_breaker.tripped` | count |
| `disk_watermark` | `fs.disk.used.percent` ¹ | % |
| `mysql_connection_pool_saturation` | `mysql.connection.pct` | % |
| `mysql_replication_lag` | `mysql.replication.lag.seconds` | s |
| `mysql_innodb_buffer_pool_pressure` | `mysql.buffer.pool.pressure.pct` | % |
| `mysql_disk_space` | `mysql.disk.used.percent` ¹ | % |

¹ Disk metrics use **used %** (not available bytes) so the chart trends upward as the problem worsens — consistent with every other analyzer. `used % = (total - available) / total * 100`. The baseline p50/p95 are also in used % terms.

---

## 8. Non-Functional Requirements

| Requirement | Target | Notes |
|-------------|--------|-------|
| Endpoint latency | < 200ms p95 | Reads at most ~48 verdict rows + 1 baseline row — should be fast with existing indexes |
| Regression safety | All existing issue card behaviour unchanged | Text, recommendation, related metrics, copy button, severity colours — none of these change |
| Backward compatibility | If `trend` endpoint returns empty array, chart section is hidden | Never shows broken/empty axes |
| Tenant isolation | Endpoint rejects requests for clusters not belonging to resolved tenant | Same pattern as `/dashboard/summary` |
| No raw metrics stored | Data points are parsed from verdict evidence strings, not raw Grafana payloads | Complies with no-raw-metrics-storage constraint |

---

## 9. Open Questions

| Question | Owner | Needed by |
|----------|-------|-----------|
| Should per-instance verdicts (MySQL InnoDB buffer pool) show a separate trend line per instance, or the most-degraded instance only? | Murali | Before backend implementation |
| Should the y-axis domain be fixed (0–100 for %) or auto-scaled to the data range? Auto-scale shows deviation more clearly but can exaggerate small absolute changes. | Murali | Before frontend implementation |
| ~~Verdict history cadence too coarse?~~ | ~~Murali~~ | **Resolved** — runner tightened to 60s (was 300s); ~1440 points/day. Subtitle communicates cadence. |
| ~~Disk metrics trend direction~~ | ~~Murali~~ | **Resolved** — use used % for disk analyzers, not available bytes. |

---

## 10. Acceptance Criteria

**Layout & position**
- [ ] Given an expanded issue card, the chart appears below the WHY/WHAT TO DO columns and above RELATED METRICS
- [ ] Given an expanded issue card, the chart container is 120px tall (not 56px)

**Real data**
- [ ] Given a cluster with a `fielddata_circuit_breaker` critical issue, when the issue card is expanded, the chart plots `circuit_breaker.tripped` values over time — not CPU
- [ ] Given a cluster with at least 3 verdict history points in the last 24h, when the issue card is expanded, the chart shows real data points keyed to real `metric_ts` timestamps
- [ ] Each data point is rendered as a visible dot on the line

**Baseline lines**
- [ ] Given a cluster with a valid baseline for the primary metric, two dashed reference lines appear at the p50 and p95 values with labels at the right edge

**Issue onset marker**
- [ ] A vertical dashed line labelled "Issue started" appears at the first `run_at` where status = current non-healthy status
- [ ] The marker is absent when the issue is on its first verdict (no prior history to compare)

**Disk metric direction**
- [ ] Given a `disk_watermark` or `mysql_disk_space` issue, the chart plots disk used % (trending upward as problem worsens) — not available bytes

**Axes & labels**
- [ ] X-axis shows readable time labels (HH:mm for 24h window)
- [ ] Y-axis shows numeric value with correct unit suffix (%, s, count)
- [ ] Chart subtitle reads "Sampled every ~1 min (analyzer cadence)"
- [ ] Tooltip on hover shows exact metric value and timestamp

**Empty & loading states**
- [ ] Given fewer than 3 verdict history points, the chart section shows "Chart available after 3 analyzer runs. X of 3 collected." — not a static dead-end message
- [ ] Given the new endpoint is unreachable, the issue card renders correctly without the chart — no crash, no error boundary

**Regression guards**
- [ ] Given any existing issue card, when opened, the WHY THIS IS HAPPENING, WHAT TO DO, RELATED METRICS sections are unchanged in content and position
- [ ] All existing 110 backend tests continue to pass
- [ ] No new TypeScript type errors introduced
- [ ] Feature works in both light and dark mode

---

## 11. Dependencies

**Depends on (must be built first):**
- Existing `verdicts` and `verdict_evidence` tables (complete)
- Existing `baseline_profiles` table with `is_valid` property (complete)
- Existing issue card component in `DatabaseDetailPage.tsx` (complete)

**Blocks (cannot be built until this is done):**
- Nothing — this is a self-contained improvement to an existing panel

---

## 12. Related Specs

- `_specs/plan-master.md` — overall build sequence
- `_specs/plan-master-v2.md` — Phase 3 hardening scope

---

*DB Intelligence Platform — Internal use only*
