import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDashboard } from '@/hooks/useDashboard';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, AlertCircle, AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import type { Database } from '@/types';

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

// ── Stat strip (4 numbers at the top) ────────────────────────────────────────

function StatStrip({ total, healthy, warning, critical, cost }: {
  total: number; healthy: number; warning: number; critical: number;
  cost: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[
        { label: 'Total clusters', value: total, color: 'text-foreground' },
        { label: 'Healthy',        value: healthy, color: 'text-emerald-600 dark:text-emerald-400' },
        { label: 'Need attention', value: warning + critical, color: warning + critical > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground' },
        { label: 'Monthly cost',   value: formatCurrency(cost), color: 'text-foreground' },
      ].map(s => (
        <div key={s.label} className="bg-muted/50 rounded-lg px-4 py-3">
          <p className="text-xs text-muted-foreground">{s.label}</p>
          <p className={cn('text-2xl font-semibold mt-0.5', s.color)}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Issue row (ranked list left panel) ───────────────────────────────────────

function IssueRow({ issue, onClick }: { issue: import('@/types').Issue; onClick: () => void }) {
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
      <div className="min-w-0">
        <p className="text-sm font-medium leading-snug truncate">{issue.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{issue.databaseName}</p>
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
        </p>
      </div>
      {!isHealthy && db.activeIssues > 0 && (
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {db.activeIssues} issue{db.activeIssues !== 1 ? 's' : ''}
        </span>
      )}
      <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-xs flex-shrink-0">→</span>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function OverviewPage() {
  const { clusters: rawClusters, issues: allIssues, loading, error, lastFetched, refresh } = useDashboard();
  // Backend is the scoring authority — use its healthScore/healthStatus directly.
  // useScoredDatabases is for mock data only.
  const databases = rawClusters;
  const [search, setSearch] = useState('');
  const [showHealthy, setShowHealthy] = useState(false);
  const navigate = useNavigate();

  const { critical, degraded, healthy, activeIssues, totalCost } = useMemo(() => {
    const critical  = databases.filter(db => db.healthStatus === 'critical');
    const degraded  = databases.filter(db => db.healthStatus === 'warning');
    const healthy   = databases.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good');
    const activeIssues = allIssues.filter(i => i.status === 'active');
    const totalCost = databases.reduce((s, db) => s + db.monthlyCost, 0);
    return { critical, degraded, healthy, activeIssues, totalCost };
  }, [databases, allIssues]);

  const needsAttention = [...critical, ...degraded];

  // Ranked issue feed — critical first, then warning
  const rankedIssues = useMemo(() => {
    return [...activeIssues].sort((a, b) => {
      if (a.severity === b.severity) return 0;
      return a.severity === 'critical' ? -1 : 1;
    });
  }, [activeIssues]);

  // Filtered cluster list for the right panel
  const filteredClusters = useMemo(() => {
    const pool = showHealthy ? databases : needsAttention;
    if (!search.trim()) return pool;
    const q = search.toLowerCase();
    return pool.filter(db =>
      db.name.toLowerCase().includes(q) ||
      db.type.toLowerCase().includes(q) ||
      db.region.toLowerCase().includes(q)
    );
  }, [databases, needsAttention, showHealthy, search]);

  const allHealthy = needsAttention.length === 0;

  return (
    <div className="space-y-5">

      {/* Top bar */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {databases.length} clusters · {loading ? 'updating…' : error ? 'using cached data' : lastFetched ? `updated ${lastFetched.toLocaleTimeString()}` : 'loading…'}
          </p>
        </div>
      </div>

      {/* Stat strip */}
      <StatStrip
        total={databases.length}
        healthy={healthy.length}
        warning={degraded.length}
        critical={critical.length}
        cost={totalCost}
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
                    onClick={() => navigate(`/databases/${issue.databaseId}`)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Right: affected clusters */}
          <div className="lg:col-span-3 rounded-lg border bg-card">
            <div className="px-4 py-3 border-b flex items-center gap-2">
              <p className="text-sm font-semibold flex-1">Clusters needing attention</p>
              <Chip variant={critical.length > 0 ? 'red' : 'amber'}>
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
  );
}
