import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockData } from '@/data/mock-data';
import { cn } from '@/lib/utils';
import { Search, Database, AlertCircle, AlertTriangle, Info, X, ArrowRight } from 'lucide-react';
import type { Database as DB } from '@/types';
import type { Issue } from '@/types';

interface ClusterResult {
  kind: 'cluster';
  id: string;
  label: string;
  sublabel: string;
  status: DB['healthStatus'];
  href: string;
}

interface IssueResult {
  kind: 'issue';
  id: string;
  label: string;
  sublabel: string;
  severity: Issue['severity'];
  href: string;
}

type Result = ClusterResult | IssueResult;

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: DB['healthStatus']) {
  if (status === 'critical') return 'bg-red-500';
  if (status === 'warning')  return 'bg-amber-500';
  if (status === 'excellent' || status === 'good') return 'bg-emerald-500';
  return 'bg-gray-400';
}

function SeverityIcon({ severity }: { severity: Issue['severity'] }) {
  if (severity === 'critical') return <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />;
  if (severity === 'warning')  return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />;
  return <Info className="h-3.5 w-3.5 text-blue-500 flex-shrink-0" />;
}

function highlight(text: string, query: string) {
  if (!query.trim()) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 text-inherit rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CommandPalette() {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const navigate  = useNavigate();
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);

  // ── Open on Cmd+K / Ctrl+K ──────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // ── Search logic ─────────────────────────────────────────────────────────
  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();

    // Empty query — show critical clusters first, then open issues
    if (!q) {
      const criticalClusters: ClusterResult[] = mockData.databases
        .filter(db => db.healthStatus === 'critical' || db.healthStatus === 'warning')
        .slice(0, 4)
        .map(db => ({
          kind: 'cluster',
          id: db.id,
          label: db.name,
          sublabel: `${db.type} · ${db.cloud.toUpperCase()} · ${db.region}`,
          status: db.healthStatus,
          href: `/databases/${db.id}`,
        }));

      const openIssues: IssueResult[] = mockData.issues
        .filter(i => i.status === 'active' && i.severity === 'critical')
        .slice(0, 3)
        .map(i => ({
          kind: 'issue',
          id: i.id,
          label: i.title,
          sublabel: i.databaseName,
          severity: i.severity,
          href: `/databases/${i.databaseId}`,
        }));

      return [...criticalClusters, ...openIssues];
    }

    // Match clusters
    const clusterResults: ClusterResult[] = mockData.databases
      .filter(db =>
        db.name.toLowerCase().includes(q) ||
        db.type.toLowerCase().includes(q) ||
        db.region.toLowerCase().includes(q) ||
        db.cloud.toLowerCase().includes(q) ||
        db.environment.toLowerCase().includes(q)
      )
      .slice(0, 6)
      .map(db => ({
        kind: 'cluster',
        id: db.id,
        label: db.name,
        sublabel: `${db.type} · ${db.cloud.toUpperCase()} · ${db.region}`,
        status: db.healthStatus,
        href: `/databases/${db.id}`,
      }));

    // Match issues
    const issueResults: IssueResult[] = mockData.issues
      .filter(i =>
        i.title.toLowerCase().includes(q) ||
        i.databaseName.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
      )
      .slice(0, 4)
      .map(i => ({
        kind: 'issue',
        id: i.id,
        label: i.title,
        sublabel: i.databaseName,
        severity: i.severity,
        href: `/databases/${i.databaseId}`,
      }));

    return [...clusterResults, ...issueResults];
  }, [query]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(c => Math.min(c + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(c => Math.max(c - 1, 0));
    } else if (e.key === 'Enter' && results[cursor]) {
      navigate(results[cursor].href);
      setOpen(false);
    }
  }, [results, cursor, navigate]);

  // Keep cursor in bounds when results change
  useEffect(() => {
    setCursor(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const select = (r: Result) => {
    navigate(r.href);
    setOpen(false);
  };

  if (!open) return null;

  // ── Sections for empty state ──────────────────────────────────────────────
  const clusterResults = results.filter(r => r.kind === 'cluster') as ClusterResult[];
  const issueResults   = results.filter(r => r.kind === 'issue')   as IssueResult[];
  const hasResults     = results.length > 0;
  const isEmptyQuery   = !query.trim();

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4"
      onClick={() => setOpen(false)}
    >
      {/* Dimmed bg */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" />

      {/* Panel */}
      <div
        className="relative w-full max-w-xl bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search clusters, issues, regions…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto">
          {!hasResults && query && (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No clusters or issues match <span className="font-medium">"{query}"</span>
            </div>
          )}

          {hasResults && (
            <div className="py-1">
              {/* Cluster section */}
              {clusterResults.length > 0 && (
                <>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {isEmptyQuery ? 'Clusters needing attention' : 'Clusters'}
                  </p>
                  {clusterResults.map((r, i) => {
                    const globalIdx = i;
                    const active = cursor === globalIdx;
                    return (
                      <button
                        key={r.id}
                        data-idx={globalIdx}
                        onClick={() => select(r)}
                        onMouseEnter={() => setCursor(globalIdx)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          active ? 'bg-muted' : 'hover:bg-muted/50'
                        )}
                      >
                        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColor(r.status))} />
                        <Database className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {highlight(r.label, query)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {highlight(r.sublabel, query)}
                          </p>
                        </div>
                        {(r.status === 'critical' || r.status === 'warning') && (
                          <span className={cn(
                            'text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0',
                            r.status === 'critical'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                          )}>
                            {r.status}
                          </span>
                        )}
                        {active && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                      </button>
                    );
                  })}
                </>
              )}

              {/* Issue section */}
              {issueResults.length > 0 && (
                <>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {isEmptyQuery ? 'Critical issues' : 'Issues'}
                  </p>
                  {issueResults.map((r, i) => {
                    const globalIdx = clusterResults.length + i;
                    const active = cursor === globalIdx;
                    return (
                      <button
                        key={r.id}
                        data-idx={globalIdx}
                        onClick={() => select(r)}
                        onMouseEnter={() => setCursor(globalIdx)}
                        className={cn(
                          'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          active ? 'bg-muted' : 'hover:bg-muted/50'
                        )}
                      >
                        <SeverityIcon severity={r.severity} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {highlight(r.label, query)}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {highlight(r.sublabel, query)}
                          </p>
                        </div>
                        {active && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* Footer hint */}
          <div className="border-t border-border px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> navigate</span>
            <span><kbd className="font-mono">↵</kbd> open</span>
            <span><kbd className="font-mono">esc</kbd> close</span>
            <span className="ml-auto">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
