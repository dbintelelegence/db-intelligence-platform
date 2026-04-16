import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTimeRange } from '@/hooks/useTimeRange';
import { useDashboard } from '@/hooks/useDashboard';
import { useVerdictTrend } from '@/hooks/useVerdictTrend';
import { generateMetricsTimeSeries } from '@/data/generators/metrics-time-series-generator';
import { formatCurrency } from '@/lib/formatters';
import { ClusterAIPanel } from '@/components/features/database-detail/ClusterAIPanel';
import type { VerdictTrend } from '@/lib/api';
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine
} from 'recharts';
import {
  ArrowLeft, AlertCircle, AlertTriangle, Info, CheckCircle2,
  ExternalLink, ChevronDown, ChevronRight, Copy, Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimestamp } from '@/lib/formatters';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import type { Issue } from '@/types';

// ── Severity helpers ──────────────────────────────────────────────────────────

function severityColor(s: Issue['severity']) {
  if (s === 'critical') return 'text-red-600 dark:text-red-400';
  if (s === 'warning')  return 'text-amber-600 dark:text-amber-400';
  return 'text-blue-600 dark:text-blue-400';
}

function severityBorder(s: Issue['severity']) {
  if (s === 'critical') return 'border-red-300 dark:border-red-800';
  if (s === 'warning')  return 'border-amber-300 dark:border-amber-800';
  return 'border-blue-300 dark:border-blue-800';
}

function severityBg(s: Issue['severity']) {
  if (s === 'critical') return 'bg-red-50 dark:bg-red-950/30';
  if (s === 'warning')  return 'bg-amber-50 dark:bg-amber-950/30';
  return 'bg-blue-50 dark:bg-blue-950/30';
}

function SeverityIcon({ severity, className }: { severity: Issue['severity']; className?: string }) {
  if (severity === 'critical') return <AlertCircle className={cn('h-4 w-4', className)} />;
  if (severity === 'warning')  return <AlertTriangle className={cn('h-4 w-4', className)} />;
  return <Info className={cn('h-4 w-4', className)} />;
}

// ── Copyable command ──────────────────────────────────────────────────────────

function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mt-3 flex items-start gap-2 bg-muted rounded-md px-3 py-2">
      <code className="text-xs font-mono flex-1 leading-relaxed text-foreground break-all">
        {command}
      </code>
      <button
        onClick={copy}
        className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
        title="Copy command"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ── Real metric trend chart ───────────────────────────────────────────────────

const INSTANCE_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#8b5cf6', '#06b6d4'];

function TrendChart({ data, issue }: { data: VerdictTrend; issue: Issue }) {
  const lineColor = issue.severity === 'critical' ? '#ef4444' : '#f59e0b';
  const multiInstance = data.series.length > 1;

  // Flatten all points for reference line positioning; each series has its own data
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-0.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Metric trend (last 24h)
        </p>
        <span className="text-[10px] text-muted-foreground font-mono">{data.metric_name}</span>
      </div>
      <p className="text-[10px] text-muted-foreground mb-2">Sampled every ~1 min (analyzer cadence)</p>

      {data.series.map((series, idx) => {
        const color = multiInstance ? INSTANCE_COLORS[idx % INSTANCE_COLORS.length] : lineColor;
        const points = series.points.map(p => ({ ts: p.ts, value: p.value }));

        return (
          <div key={series.instance_id ?? 'cluster'} className="h-[120px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 8, right: 48, bottom: 4, left: 0 }}>
                <XAxis
                  dataKey="ts"
                  tickFormatter={(ts: string) => {
                    try { return format(parseISO(ts), 'HH:mm'); } catch { return ts; }
                  }}
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v: number) => `${v}${data.unit}`}
                  width={36}
                  domain={['auto', 'auto']}
                  axisLine={false}
                  tickLine={false}
                />
                {data.baseline && (
                  <>
                    <ReferenceLine
                      y={data.baseline.p50}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="4 3"
                      strokeOpacity={0.4}
                      label={{ value: 'p50', position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                    />
                    <ReferenceLine
                      y={data.baseline.p95}
                      stroke="#f59e0b"
                      strokeDasharray="4 3"
                      strokeOpacity={0.5}
                      label={{ value: 'p95', position: 'right', fontSize: 10, fill: '#f59e0b' }}
                    />
                  </>
                )}
                {data.issue_started_at && (
                  <ReferenceLine
                    x={data.issue_started_at}
                    stroke={lineColor}
                    strokeDasharray="4 3"
                    strokeOpacity={0.7}
                    label={{ value: 'Issue started', position: 'insideTopLeft', fontSize: 10, fill: lineColor }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={color}
                  strokeWidth={1.5}
                  dot={{ r: 3, fill: color, strokeWidth: 0 }}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: 11,
                    padding: '4px 8px',
                    border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--background))',
                  }}
                  formatter={(v: unknown) => [`${(v as number).toFixed(2)}${data.unit}`, data.metric_name]}
                  labelFormatter={(ts: string) => {
                    try { return format(parseISO(ts), 'HH:mm dd MMM'); } catch { return ts; }
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        );
      })}

      {/* Per-instance legend */}
      {multiInstance && (
        <div className="flex flex-wrap gap-3 mt-1">
          {data.series.map((series, idx) => (
            <div key={series.instance_id ?? 'cluster'} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: INSTANCE_COLORS[idx % INSTANCE_COLORS.length] }}
              />
              <span className="text-[10px] text-muted-foreground font-mono">
                {series.instance_id ?? 'cluster'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IssueChartSection({ issue }: { issue: Issue }) {
  const { data, loading, error } = useVerdictTrend(issue.databaseId, issue.analyzerName);

  if (loading) {
    return <div className="h-[120px] bg-muted/40 rounded animate-pulse" />;
  }

  // Hide entirely on error or no data
  if (error || !data || data.series.length === 0) {
    return null;
  }

  // Not enough data yet — show progress
  if (data.points_collected < 3) {
    return (
      <p className="text-xs text-muted-foreground">
        Chart available after 3 analyzer runs. {data.points_collected} of 3 collected.
      </p>
    );
  }

  return <TrendChart data={data} issue={issue} />;
}

// ── Issue card ────────────────────────────────────────────────────────────────

function IssueCard({ issue }: { issue: Issue }) {
  const [expanded, setExpanded] = useState(issue.severity === 'critical');

  const hasCommand = issue.recommendation.toLowerCase().includes('set ') ||
    issue.recommendation.toLowerCase().includes('run ') ||
    issue.recommendation.toLowerCase().includes('execute ') ||
    issue.recommendation.toLowerCase().includes('alter ');

  return (
    <div className={cn(
      'rounded-lg border-2 overflow-hidden',
      severityBorder(issue.severity)
    )}>
      {/* Header — always visible */}
      <button
        onClick={() => setExpanded(v => !v)}
        className={cn(
          'w-full flex items-start gap-3 px-4 py-3 text-left',
          severityBg(issue.severity)
        )}
      >
        <SeverityIcon severity={issue.severity} className={cn('mt-0.5 flex-shrink-0', severityColor(issue.severity))} />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-0.5" title={formatDistanceToNow(issue.detectedAt, { addSuffix: true })}>
            {formatTimestamp(issue.detectedAt)}
          </p>
          <p className="text-sm font-semibold">{issue.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{issue.description}</p>
        </div>
        <div className="flex-shrink-0">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 py-4 bg-background border-t border-border space-y-4">

          {/* Root cause + recommendation — actions first */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                Why this is happening
              </p>
              <p className="text-sm text-foreground leading-relaxed">
                {issue.explanation}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                What to do
              </p>
              <p className="text-sm text-foreground leading-relaxed">
                {issue.recommendation}
              </p>
              {hasCommand && (
                <CopyableCommand command={issue.recommendation} />
              )}
            </div>
          </div>

          {/* Real trend chart — supporting evidence below the actions */}
          <IssueChartSection issue={issue} />

          {/* Related metrics */}
          {issue.relatedMetrics.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
                Related metrics
              </p>
              <div className="flex flex-wrap gap-1.5">
                {issue.relatedMetrics.map(m => (
                  <span key={m} className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stat with baseline context ────────────────────────────────────────────────

function StatWithBaseline({ label, value, unit, baseline, status }: {
  label: string;
  value: number;
  unit: string;
  baseline?: string;
  status?: 'ok' | 'warn' | 'critical';
}) {
  return (
    <div className="bg-muted/50 rounded-lg px-4 py-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-baseline gap-1">
        <span className={cn(
          'text-xl font-semibold',
          status === 'critical' && 'text-red-600 dark:text-red-400',
          status === 'warn'     && 'text-amber-600 dark:text-amber-400',
          status === 'ok'       && 'text-foreground',
        )}>
          {value.toFixed(value < 10 ? 1 : 0)}
        </span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      {baseline && (
        <p className="text-[10px] text-muted-foreground mt-0.5">Normal: {baseline}</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DatabaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showAllMetrics, setShowAllMetrics] = useState(true);
  const { timeRange } = useTimeRange('24h');
  const { clusters, issues: allIssues, loading } = useDashboard();

  const database = useMemo(() => {
    if (!id) return null;
    return clusters.find(c => c.id === id) ?? null;
  }, [id, clusters]);

  const issues = useMemo(() => {
    if (!id) return [];
    return allIssues
      .filter(i => i.databaseId === id)
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return order[a.severity] - order[b.severity];
      });
  }, [id, allIssues]);

  const activeIssues = issues.filter(i => i.status === 'active');

  const metricsData = useMemo(() => {
    if (!database) return null;
    return generateMetricsTimeSeries(database, timeRange);
  }, [database, timeRange]);

  if (!database && loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
        <p className="text-sm text-muted-foreground">Loading cluster…</p>
      </div>
    );
  }

  if (!database) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <p className="text-muted-foreground">Cluster not found</p>
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to overview
        </button>
      </div>
    );
  }

  const isHealthy = database.healthStatus === 'excellent' || database.healthStatus === 'good';

  const statusColors = {
    excellent: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
    good:      'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
    warning:   'text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
    critical:  'text-red-600 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800',
    unknown:   'text-gray-600 bg-gray-50 border-gray-200',
  };

  return (
    <div className="space-y-4 w-full">

      {/* Back nav */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>

      {/* Cluster identity + status */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{database.name}</h1>
            <span className={cn(
              'inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border',
              statusColors[database.healthStatus]
            )}>
              {isHealthy
                ? <CheckCircle2 className="h-3 w-3" />
                : <AlertCircle className="h-3 w-3" />}
              {database.healthStatus}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {database.type} · {database.cloud.toUpperCase()} · {database.region} · {database.environment}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {database.lastChecked ? `Last checked ${formatDistanceToNow(database.lastChecked, { addSuffix: true })}` : 'Never analyzed'}
          </p>
        </div>

        <a
          href={`https://app.datadoghq.com/`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg px-3 py-2 transition-colors hover:bg-muted"
        >
          <ExternalLink className="h-3 w-3" />
          View full metrics in Datadog
        </a>
      </div>

      {/* ── Key stats ── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        <StatWithBaseline
          label="CPU"
          value={database.metrics.cpu}
          unit="%"
          baseline="< 70%"
          status={database.metrics.cpu >= 85 ? 'critical' : database.metrics.cpu >= 70 ? 'warn' : 'ok'}
        />
        <StatWithBaseline
          label="Memory"
          value={database.metrics.memory}
          unit="%"
          baseline="< 75%"
          status={database.metrics.memory >= 85 ? 'critical' : database.metrics.memory >= 75 ? 'warn' : 'ok'}
        />
        <StatWithBaseline
          label="Storage"
          value={database.metrics.storage}
          unit="%"
          baseline="< 80%"
          status={database.metrics.storage >= 90 ? 'critical' : database.metrics.storage >= 80 ? 'warn' : 'ok'}
        />
        {database.type === 'mysql' ? (
          <StatWithBaseline
            label="Repl Lag"
            value={Math.round((database.metrics as any).replicationLagMs ?? 0)}
            unit="ms"
            baseline="< 10s"
            status={
              ((database.metrics as any).replicationLagMs ?? 0) >= 60000 ? 'critical'
              : ((database.metrics as any).replicationLagMs ?? 0) >= 10000 ? 'warn'
              : 'ok'
            }
          />
        ) : (
          <StatWithBaseline
            label="Latency"
            value={database.metrics.latency}
            unit="ms"
            baseline="< 50ms"
            status={database.metrics.latency >= 100 ? 'critical' : database.metrics.latency >= 50 ? 'warn' : 'ok'}
          />
        )}
        <StatWithBaseline
          label="Connections"
          value={database.metrics.connections}
          unit={`/ ${database.metrics.maxConnections}`}
          baseline={`< ${Math.round(database.metrics.maxConnections * 0.8)}`}
          status={
            database.metrics.connections >= database.metrics.maxConnections * 0.9 ? 'critical'
            : database.metrics.connections >= database.metrics.maxConnections * 0.8 ? 'warn'
            : 'ok'
          }
        />
        <StatWithBaseline
          label="Throughput"
          value={database.metrics.throughput}
          unit="qps"
          status="ok"
        />
      </div>

      {/* ── Two-column layout: main content left, AI panel right ── */}
      <div className="flex gap-4 items-start">

        {/* ── Left column: issues + metric charts + cost ── */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Active issues */}
          {activeIssues.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-semibold">
                {activeIssues.length} active issue{activeIssues.length !== 1 ? 's' : ''}
              </p>
              {activeIssues.map(issue => (
                <IssueCard key={issue.id} issue={issue} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                No active issues — this cluster is healthy
              </p>
            </div>
          )}

          {/* Metric charts — open by default, full width of left column */}
          <div className="rounded-lg border border-border overflow-hidden">
            <button
              onClick={() => setShowAllMetrics(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 hover:bg-muted/50 transition-colors text-sm"
            >
              <span className="font-medium">Metric charts (last 24h)</span>
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="text-xs">These are generated — connect your real data source for live charts</span>
                {showAllMetrics ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </div>
            </button>

            {showAllMetrics && metricsData && (
              <div className="p-4 grid grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'CPU %',        data: metricsData.cpu,         color: '#f97316', threshold: 80 },
                  { label: 'Memory %',     data: metricsData.memory,      color: '#3b82f6', threshold: 80 },
                  { label: 'Storage %',    data: metricsData.storage,     color: '#8b5cf6', threshold: 85 },
                  { label: 'Latency ms',   data: metricsData.latency,     color: '#eab308', threshold: 100 },
                  { label: 'Connections',  data: metricsData.connections, color: '#22c55e' },
                  { label: 'Throughput',   data: metricsData.throughput,  color: '#06b6d4' },
                ].map(({ label, data, color, threshold }) => (
                  <div key={label} className="rounded-lg border border-border p-3 bg-background">
                    <p className="text-xs font-medium text-muted-foreground mb-2">{label}</p>
                    <div className="h-24">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.map(p => ({ value: parseFloat(p.value.toFixed(1)) }))}>
                          <YAxis domain={['auto', 'auto']} hide />
                          {threshold && (
                            <ReferenceLine y={threshold} stroke="#ef4444" strokeDasharray="4 3" strokeWidth={1} strokeOpacity={0.6} />
                          )}
                          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
                          <Tooltip
                            contentStyle={{ fontSize: 11, padding: '3px 8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--background))' }}
                            formatter={(v: unknown) => [v as number, label]}
                            labelFormatter={() => ''}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cost */}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3 text-sm">
            <span className="text-muted-foreground">Monthly cost</span>
            <div className="flex items-center gap-3">
              <span className="font-semibold">{formatCurrency(database.monthlyCost)}</span>
              <span className={cn(
                'text-xs',
                database.costTrend === 'up'   && 'text-red-600',
                database.costTrend === 'down' && 'text-emerald-600',
                database.costTrend === 'stable' && 'text-muted-foreground',
              )}>
                {database.costTrend === 'up' && '↑ +12% vs last month'}
                {database.costTrend === 'down' && '↓ −8% vs last month'}
                {database.costTrend === 'stable' && 'Stable'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Right column: AI panel, sticky ── */}
        <div className="w-[380px] flex-shrink-0 sticky top-4">
          <ClusterAIPanel database={database} issues={issues} />
        </div>

      </div>
    </div>
  );
}
