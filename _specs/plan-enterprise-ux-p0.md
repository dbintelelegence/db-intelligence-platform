# Plan: Enterprise UX — P0 Non-Negotiables

**Date:** 2026-04-14  
**Branch:** feat/new-layout  
**Goal:** Fix the 5 issues that block a credible enterprise demo.

---

## Discovery Summary

### Current data flow (the core problem)

```
Backend API
    ↓
useDashboard()   ← fetches once on mount, no auto-refresh, no shared state
    ↓
OverviewPage     ← live data ✓
IssuesPage       ← live data ✓
DatabasesPage    ← live data ✓
DatabaseDetailPage ← live data ✓
SummarizationPanel ← live data ✓

TabNavigation    ← mockData ONLY ✗ (badge counts wrong)
Header           ← mockData ONLY ✗ (unread alert count wrong)
```

Every page calls `useDashboard()` independently. No shared state → if we add
auto-refresh in the hook, each component starts its own 30s timer. We need one
shared timer and one fetch.

### Key constraints discovered

1. `useDashboard()` is used in 5 places — changing its shape is safe as long as
   we keep the same return fields and just add `secondsSinceFetch`.
2. `SummarizationPanel` mounts **inside `<header>`** via `Header.tsx` state.
   Moving it to a right-side drawer requires lifting the `showSummarization`
   state up to `AppLayout` (or a context).
3. `IssueDetailPanel` is a centered modal. Converting to right-side drawer is
   purely a CSS change — props unchanged.
4. `TabNavigation` uses `mockData` directly — no hook. Must swap to live data.
5. `AppLayout` has no right-side slot. AI drawer can be `position:fixed right-0`
   without changing the layout grid.
6. Stale warning is currently inline muted text in the OverviewPage subtitle.
   Needs to be a full-width banner.

---

## What We Are Building (P0 only)

| # | Fix | Files changed |
|---|-----|---------------|
| 1 | Auto-refresh every 30s + live "updated Xs ago" counter | `useDashboard.ts` |
| 2 | Shared dashboard state (one fetch, consistent badges everywhere) | `DashboardContext.tsx` (new), `main.tsx`, `AppLayout.tsx` |
| 3 | Wire sidebar badges to live data | `TabNavigation.tsx` |
| 4 | Stale data → loud full-width banner | `OverviewPage.tsx` |
| 5 | AI panel → right-side drawer (fixed, not floating/draggable) | `SummarizationPanel.tsx`, `AppLayout.tsx`, `Header.tsx` |
| 6 | Issue detail → right-side slide-over drawer | `IssueDetailPanel.tsx` |

**Not in this plan:** time range picker (P1), issue state machine (P1), health score breakdown (P1).

---

## Detailed Implementation

### Fix 1 + 2: DashboardContext + auto-refresh

**New file:** `src/context/DashboardContext.tsx`

- Wraps the existing `useDashboard` logic in a React context.
- Exports `DashboardProvider` and `useDashboardContext()`.
- Auto-refresh: `setInterval(() => setTick(t => t+1), 30_000)` inside a `useEffect`.
- Live counter: a second `setInterval` that increments `secondsSinceFetch` every 1s.
- Resets `secondsSinceFetch` to 0 on each successful fetch.
- On error: falls back to mock data (same as current `useDashboard`).
- Provides: `{ clusters, issues, loading, error, lastFetched, secondsSinceFetch, refresh }`.

**Edit `src/main.tsx`:**
- Wrap root with `<DashboardProvider>` (inside `ScoringConfigProvider`, outside `RouterProvider`).

**Edit `src/hooks/useDashboard.ts`:**
- Keep the existing hook for backward compatibility.
- Add `secondsSinceFetch: number` to the return type.
- Wire it to call `useDashboardContext()` internally — so all 5 existing callers
  get the shared context for free without any changes to those files.

> This is the lowest-risk approach: existing consumers (`OverviewPage`, `IssuesPage`,
> `DatabasesPage`, `DatabaseDetailPage`, `SummarizationPanel`) keep calling
> `useDashboard()` exactly as before — they just now get shared context underneath.

### Fix 3: Sidebar badges → live data

**Edit `src/components/layout/TabNavigation.tsx`:**
- Remove `import { mockData }` line.
- Import `useDashboardContext` from `@/context/DashboardContext`.
- Replace `mockData.issues.filter(...)` with live `issues` from context.
- Replace `mockData.databases.length` with live `clusters.length`.
- Replace all `mockData.databases.filter(db => db.cloud === ...)` with live `clusters.filter(...)`.
- Remove the "By Cloud" and "By Type" submenu counts that relied on mock data — derive
  them from `clusters` instead.

**Edit `src/components/layout/Header.tsx`:**
- Remove `import { mockData }`.
- Import `useDashboardContext`.
- Replace `mockData.alerts.filter(...)` unread count with `0` for now
  (alerts are still mock-only; the bell stays but the count becomes accurate: 0).
  This is honest — better than showing a fake "14".

### Fix 4: Stale data banner

**Edit `src/pages/OverviewPage.tsx`:**

Replace the current inline stale warning in the subtitle with a full-width
amber banner at the top of the page content, above the stat strip:

```tsx
{staleCount > 0 && (
  <div className="flex items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
      {staleCount} cluster{staleCount !== 1 ? 's have' : ' has'} stale verdicts
      — last analysis run was over 30 minutes ago. Data may not reflect current state.
    </p>
    <button onClick={refresh} className="ml-auto text-xs underline text-amber-700 dark:text-amber-300">
      Refresh now
    </button>
  </div>
)}
```

Also: move the "fetched X seconds ago" counter from the muted subtitle into the
stat strip area as a small inline indicator with an auto-refresh icon.

Use `secondsSinceFetch` from context to show a live counter.

### Fix 5: AI panel → right-side drawer

**Edit `src/components/features/summarization/SummarizationPanel.tsx`:**

Remove all the floating/draggable/resizable logic entirely:
- Delete `panelWidth`, `panelHeight`, `position`, `isResizing`, `isDragging` state
- Delete all `useRef` resize/drag refs
- Delete `handleDragStart`, `handleMouseDown`, mouse event `useEffect`
- Delete left/top/corner resize handle divs

Replace the outer container with a right-side slide-over drawer:

```tsx
// Backdrop (click to close)
<div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />

// Drawer panel — slides in from the right
<div className="fixed right-0 top-16 bottom-0 z-50 w-[480px] bg-background border-l shadow-2xl flex flex-col">
  {/* header with gradient, title, close button */}
  {/* chat interface fills the rest */}
</div>
```

`top-16` aligns with the bottom of the sticky header (64px = 4rem = top-16).
No backdrop-blur — the page stays readable behind the drawer.
Width: `w-[480px]` — standard right-drawer width (matches Datadog, Linear).
No drag, no resize handles. ESC still closes.

**Edit `src/components/layout/Header.tsx`:**
- Lift `showSummarization` out of Header — move state to `AppLayout`.
- Header receives an `onOpenAI: () => void` prop (or we use a simple context).

Simplest approach: keep `showSummarization` in Header but move `<SummarizationPanel>`
render out of `<header>` into the document body via a portal, or just move the
entire state into `AppLayout` and pass `onOpenAI` down to Header.

**Decision:** Move state to `AppLayout`. Header gets `onOpenAI` prop. AppLayout
renders `<SummarizationPanel>` at the bottom of the component tree (siblings with
`<CommandPalette>`). This is clean and avoids portals.

**Edit `src/components/layout/AppLayout.tsx`:**

```tsx
export function AppLayout() {
  const [showAI, setShowAI] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <Header onOpenAI={() => setShowAI(true)} />
      <div className="flex">
        <TabNavigation />
        <main className="flex-1 px-6 py-8 overflow-x-auto">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      {showAI && <SummarizationPanel onClose={() => setShowAI(false)} />}
    </div>
  );
}
```

**Edit `src/components/layout/Header.tsx`:**
- Add `onOpenAI: () => void` to props.
- Remove `showSummarization` state and `<SummarizationPanel>` render.
- Change "Ask AI" button to call `onOpenAI`.
- Remove `import { SummarizationPanel }`.

### Fix 6: Issue detail → right-side slide-over drawer

**Edit `src/components/features/issues/IssueDetailPanel.tsx`:**

Change the outer wrapper from a centered modal to a right-side drawer:

```tsx
// Before:
<div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
  <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full my-8">

// After:
<>
  {/* Backdrop */}
  <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
  {/* Drawer */}
  <div className="fixed right-0 top-0 bottom-0 z-50 w-[520px] bg-background border-l shadow-2xl flex flex-col">
</>
```

The drawer is `top-0 bottom-0` (full height, goes behind the header which is `z-50` —
we use `z-40` for backdrop, `z-50` for drawer, header is also `z-50` so it stays
above the drawer). Actually set drawer to `top-16` so the sticky header stays visible.

Content inside: unchanged. The scrollable content section already has `overflow-y-auto`.
Footer buttons (Close) stay at the bottom: `mt-auto border-t p-4`.

Props interface: **unchanged** — `issue: Issue` + `onClose: () => void`.
Both callers (`OverviewPage`, `IssuesPage`) need zero changes.

---

## File change summary

| File | Change type | Risk |
|------|-------------|------|
| `src/context/DashboardContext.tsx` | New file | Low |
| `src/hooks/useDashboard.ts` | Extend return type, delegate to context | Low |
| `src/main.tsx` | Add `<DashboardProvider>` wrapper | Low |
| `src/components/layout/AppLayout.tsx` | Add AI drawer state + render | Low |
| `src/components/layout/Header.tsx` | Remove AI state, accept `onOpenAI` prop, remove mock data | Low |
| `src/components/layout/TabNavigation.tsx` | Replace mockData with live context | Low |
| `src/pages/OverviewPage.tsx` | Stale banner + use `secondsSinceFetch` | Low |
| `src/components/features/summarization/SummarizationPanel.tsx` | Rip out drag/resize, replace with drawer CSS | Medium |
| `src/components/features/issues/IssueDetailPanel.tsx` | Replace centered modal with drawer CSS | Low |

Total: 9 files. No new dependencies. No backend changes.

---

## Order of implementation

1. `DashboardContext.tsx` (new) — foundation everything else depends on
2. `useDashboard.ts` — delegate to context, add `secondsSinceFetch`
3. `main.tsx` — wrap with provider
4. `Header.tsx` — accept `onOpenAI` prop, remove mock data
5. `AppLayout.tsx` — add AI drawer state
6. `TabNavigation.tsx` — live badges
7. `OverviewPage.tsx` — stale banner
8. `SummarizationPanel.tsx` — drawer conversion
9. `IssueDetailPanel.tsx` — drawer conversion

---

## Verification checklist

- [ ] Sidebar "Issues & Anomalies" badge shows live critical count (not mock 22)
- [ ] Sidebar "Databases" badge shows live cluster count
- [ ] Data refreshes automatically every 30s (check Network tab)
- [ ] "Updated Xs ago" counter increments live, resets on fetch
- [ ] Stale cluster → full-width amber banner visible
- [ ] "Ask AI" button opens a right-side drawer, not a floating overlay
- [ ] ESC closes the AI drawer
- [ ] Clicking an issue opens a right-side drawer (list stays visible behind it)
- [ ] ESC closes the issue drawer
- [ ] No console errors or TypeScript errors
