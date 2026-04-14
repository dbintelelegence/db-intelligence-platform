import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '@/hooks/useDashboard';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, AlertCircle, AlertTriangle, CheckCircle2, Search, RefreshCw } from 'lucide-react';
import { IssueDetailPanel } from '@/components/features/issues/IssueDetailPanel';
import type { Database, Issue } from '@/types';

// ── Tiny shared atoms ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  return (
    <span className={cn(
      'inline-block w-2 h-2 rounded-full flex-shrink-0',
      status === 'critical' && 'bg-red-500',
      status === 'warning'  && 'bg-amber-500',
      (status === 'excellent' || status === 'good') && 'bg-emerald-500',
      status === 'unknown'  && 'bg-gray-400',
    )} />
  );
}

function Chip({ children, variant }: { children: React.ReactNode; variant: 'red' | 'amber' | 'green' | 'gray' }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
      variant === 'red'   && 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
      variant === 'amber' && 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
      variant === 'green' && 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
      variant === 'gray'  && 'bg-muted text-muted-foreground',
    )}>
      {children}
    </span>
  );
}

// ── Verdict age helper ────────────────────────────────────────────────────────

function formatAge(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// ── Stat strip (3 numbers at the top) ────────────────────────────────────────

function StatStrip({ total, healthy, warning, critical, unknown }: {
  total: number; healthy: number; warning: number; critical: number; unknown: number;
}) {
  const navigate = useNavigate();
  const stats = [
    { label: 'Total clusters',  value: total,              color: 'text-foreground',                                                                    href: '/databases' },
    { label: 'Healthy',         value: healthy,            color: 'text-emerald-600 dark:text-emerald-400',                                             href: '/databases?status=healthy' },
    { label: 'Need attention',  value: warning + critical, color: warning + critical > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground',        href: '/databases?status=attention' },
    { label: 'No data yet',     value: unknown,            color: unknown > 0 ? 'text-muted-foreground' : 'text-foreground',                            href: '/databases' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map(s => (
        <button
          key={s.label}
          onClick={() => navigate(s.href)}
          className="bg-muted/50 rounded-lg px-4 py-3 text-left hover:bg-muted transition-colors group"
        >
          <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{s.label}</p>
          <p className={cn('text-2xl font-semibold mt-0.5 underline-offset-2 group-hover:underline', s.color)}>{s.value}</p>
        </button>
      ))}
    </div>
  );
}

// ── Issue row (ranked list left panel) ───────────────────────────────────────

function IssueRow({ issue, onClick }: { issue: Issue; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-start gap-3 px-3 py-2.5 rounded-md hover:bg-muted/60 transition-colors"
    >
      <span className={cn(
        'mt-0.5 flex-shrink-0',
        issue.severity === 'critical' ? 'text-red-500' : 'text-amber-500'
      )}>
        {issue.severity === 'critical'
          ? <AlertCircle className="h-4 w-4" />
          : <AlertTriangle className="h-4 w-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-snug truncate">{issue.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {issue.databaseName}
          {issue.instanceId && <span className="font-mono"> · {issue.instanceId}</span>}
        </p>
      </div>
      <Chip variant={issue.severity === 'critical' ? 'red' : 'amber'}>
        {issue.severity}
      </Chip>
    </button>
  );
}

// ── Cluster row (right panel list) ───────────────────────────────────────────

function ClusterRow({ db }: { db: Database }) {
  const navigate = useNavigate();
  const isHealthy = db.healthStatus === 'excellent' || db.healthStatus === 'good';

  return (
    <button
      onClick={() => navigate(`/databases/${db.id}`)}
      className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-md hover:bg-muted/60 transition-colors group"
    >
      <StatusDot status={db.healthStatus} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{db.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {db.type} · {db.cloud.toUpperCase()} · {db.region}
          {db.isStale && <span className="text-amber-500 ml-1">· stale</span>}
        </p>
      </div>
      {!isHealthy && db.activeIssues > 0 && (
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {db.activeIssues} issue{db.activeIssues !== 1 ? 's' : ''}
        </span>
      )}
      {db.verdictAgeSeconds !== null && (
        <span className={cn(
          'text-xs flex-shrink-0',
          db.isStale ? 'text-amber-500' : 'text-muted-foreground'
        )}>
          {formatAge(db.verdictAgeSeconds)}
        </span>
      )}
      <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-xs flex-shrink-0">→</span>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function OverviewPage() {
  const { clusters: rawClusters, issues: allIssues, loading, error, lastFetched, secondsSinceFetch, refresh } = useDashboard();
  // Backend is the scoring authority — use its healthScore/healthStatus directly.
  // useScoredDatabases is for mock data only.
  const databases = rawClusters;
  const [search, setSearch] = useState('');
  const [showHealthy, setShowHealthy] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  const { critical, degraded, healthy, unknown, activeIssues, staleCount } = useMemo(() => {
    const critical  = databases.filter(db => db.healthStatus === 'critical');
    const degraded  = databases.filter(db => db.healthStatus === 'warning');
    const healthy   = databases.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good');
    const unknown   = databases.filter(db => db.healthStatus === 'unknown');
    const activeIssues = allIssues.filter(i => i.status === 'active');
    const staleCount = databases.filter(db => db.isStale).length;
    return { critical, degraded, healthy, unknown, activeIssues, staleCount };
  }, [databases, allIssues]);

  const needsAttention = [...critical, ...degraded, ...unknown];

  // Ranked issue feed — critical first, then warning
  const rankedIssues = useMemo(() => {
    return [...activeIssues].sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === 'critical' ? -1 : 1;
    });
  }, [activeIssues]);

  // Filtered cluster list for the right panel
  const filteredClusters = useMemo(() => {
    const pool = showHealthy ? healthy : needsAttention;
    if (!search.trim()) return pool;
    const q = search.toLowerCase();
    return pool.filter(db =>
      db.name.toLowerCase().includes(q) ||
      db.type.toLowerCase().includes(q) ||
      db.region.toLowerCase().includes(q)
    );
  }, [databases, needsAttention, showHealthy, search]);

  // "All clear" only when nothing needs attention AND no clusters are unknown.
  // Unknown clusters haven't been analyzed yet — they shouldn't count as healthy.
  const allHealthy = needsAttention.length === 0 && unknown.length === 0;

  if (loading && databases.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Loading clusters…</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0,1,2,3].map(i => (
            <div key={i} className="bg-muted/50 rounded-lg px-4 py-3 animate-pulse">
              <div className="h-3 w-20 bg-muted rounded mb-2" />
              <div className="h-7 w-12 bg-muted rounded" />
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card p-6 flex items-center justify-center gap-3">
          <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Fetching cluster health…</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-5">

      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5">
            {databases.length} clusters
            {loading
              ? ' · updating…'
              : error
                ? ' · using cached data'
                : lastFetched
                  ? ` · updated ${secondsSinceFetch}s ago`
                  : ' · loading…'}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Stale data banner — full-width, prominent */}
      {staleCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
          <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex-1">
            {staleCount} cluster{staleCount !== 1 ? 's have' : ' has'} stale verdicts — last analysis run was over 30 minutes ago. Data may not reflect current state.
          </p>
          <button
            onClick={refresh}
            className="text-xs font-medium text-amber-700 dark:text-amber-300 underline underline-offset-2 flex-shrink-0 hover:text-amber-900 dark:hover:text-amber-100"
          >
            Refresh now
          </button>
        </div>
      )}

      {/* Stat strip */}
      <StatStrip
        total={databases.length}
        healthy={healthy.length}
        warning={degraded.length}
        critical={critical.length}
        unknown={unknown.length}
      />

      {/* All clear banner — only shown when nothing needs attention */}
      {allHealthy && (
        <div className="flex items-center gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            All {databases.length} clusters are healthy — nothing needs attention right now.
          </p>
        </div>
      )}

      {/* Main two-column panel — only shown when there's something to act on */}
      {!allHealthy && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Left: ranked issue feed */}
          <div className="lg:col-span-2 rounded-lg border bg-card">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <p className="text-sm font-semibold">Open issues</p>
              <Chip variant="gray">{rankedIssues.length}</Chip>
            </div>
            <div className="p-2 max-h-[420px] overflow-y-auto">
              {rankedIssues.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No open issues</p>
              ) : (
                rankedIssues.map(issue => (
                  <IssueRow
                    key={issue.id}
                    issue={issue}
                    onClick={() => setSelectedIssue(issue)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: affected clusters */}
          <div className="lg:col-span-3 rounded-lg border bg-card">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <p className="text-sm font-semibold flex-1">
                {critical.length > 0 ? 'Clusters needing attention' : degraded.length > 0 ? 'Clusters needing attention' : 'Clusters with no data yet'}
              </p>
              <Chip variant={critical.length > 0 ? 'red' : degraded.length > 0 ? 'amber' : 'gray'}>
                {needsAttention.length}
              </Chip>
            </div>
            <div className="p-2 max-h-[420px] overflow-y-auto">
              {needsAttention.map(db => (
                <ClusterRow key={db.id} db={db} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Healthy fleet — collapsed by default */}
      <div className="rounded-lg border bg-card overflow-hidden">
        <button
          onClick={() => setShowHealthy(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-medium">
              {healthy.length} healthy cluster{healthy.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="text-xs">
              {showHealthy ? 'Collapse' : 'Expand to browse'}
            </span>
            {showHealthy
              ? <ChevronDown className="h-4 w-4" />
              : <ChevronRight className="h-4 w-4" />}
          </div>
        </button>

        {showHealthy && (
          <>
            <div className="px-3 py-2 border-t border-b bg-muted/30">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search clusters…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            </div>
            <div className="p-2 max-h-[320px] overflow-y-auto">
              {filteredClusters.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No clusters match</p>
              ) : (
                filteredClusters.map(db => <ClusterRow key={db.id} db={db} />)
              )}
            </div>
            {healthy.length > 10 && !search && (
              <div className="px-4 py-2 border-t text-xs text-muted-foreground text-center">
                Showing {Math.min(filteredClusters.length, healthy.length)} clusters · use search to find specific ones
              </div>
            )}
          </>
        )}
      </div>

    </div>

    {/* Issue detail panel — opens inline over the page, no navigation */}
    {selectedIssue && (
      <IssueDetailPanel issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
    )}
    </>
  );
}
