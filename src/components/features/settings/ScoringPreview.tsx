import { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { computeHealthScore } from '@/lib/health-scoring';
import { getHealthStatus } from '@/constants/health-thresholds';
import { cn } from '@/lib/utils';
import type { CurrentDatabaseMetrics, DatabaseType, ScoringMetric } from '@/types';

const DB_TYPES: { value: DatabaseType; label: string }[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mongodb', label: 'MongoDB' },
  { value: 'redis', label: 'Redis' },
  { value: 'dynamodb', label: 'DynamoDB' },
  { value: 'aurora', label: 'Aurora' },
  { value: 'elasticsearch', label: 'Elasticsearch' },
];

const METRIC_LABELS: Record<ScoringMetric, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  storage: 'Storage',
  connectionRatio: 'Connections',
  latency: 'Latency',
  throughput: 'Throughput',
};

const DEFAULT_SAMPLE_METRICS: CurrentDatabaseMetrics = {
  cpu: 45,
  memory: 62,
  storage: 55,
  connections: 35,
  maxConnections: 100,
  latency: 25,
  throughput: 800,
};

/** Default sample values for each type-specific metric */
const DEFAULT_CUSTOM_VALUES: Record<DatabaseType, Record<string, number>> = {
  postgres: { replicationLag: 2 },
  mysql: { slowQueryRatio: 3 },
  mongodb: { lockContention: 5 },
  redis: { evictionRate: 20 },
  dynamodb: { throttledRequests: 1 },
  aurora: { bufferCacheHitRatio: 97 },
  elasticsearch: { shardBalance: 85 },
};

function getBandColorClass(subScore: number) {
  if (subScore >= 90) return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (subScore >= 70) return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
  if (subScore >= 40) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
}

export function ScoringPreview() {
  const { config } = useScoringConfig();
  const [dbType, setDbType] = useState<DatabaseType>('postgres');
  const [metrics, setMetrics] = useState<CurrentDatabaseMetrics>(DEFAULT_SAMPLE_METRICS);
  const [customValues, setCustomValues] = useState<Record<DatabaseType, Record<string, number>>>(DEFAULT_CUSTOM_VALUES);

  const currentProfile = config.profiles.find(p => p.dbType === dbType);
  const currentCustomValues = customValues[dbType] ?? {};

  const breakdown = useMemo(() => {
    return computeHealthScore(metrics, dbType, config, currentCustomValues);
  }, [metrics, dbType, config, currentCustomValues]);

  const healthStatus = getHealthStatus(breakdown.overallScore);

  const handleMetricChange = (field: keyof CurrentDatabaseMetrics, value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    setMetrics(prev => ({ ...prev, [field]: numValue }));
  };

  const handleCustomMetricChange = (key: string, value: string) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    setCustomValues(prev => ({
      ...prev,
      [dbType]: { ...prev[dbType], [key]: numValue },
    }));
  };

  const statusColors: Record<string, string> = {
    excellent: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20',
    good: 'text-green-500 bg-green-50 dark:bg-green-900/20',
    warning: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
    critical: 'text-red-500 bg-red-50 dark:bg-red-900/20',
    unknown: 'text-gray-400 bg-gray-50 dark:bg-gray-900/20',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Live Scoring Preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Database type selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium">Database Type:</label>
          <select
            value={dbType}
            onChange={(e) => setDbType(e.target.value as DatabaseType)}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
          >
            {DB_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Sample metric inputs */}
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">CPU (%)</label>
            <input
              type="number"
              value={metrics.cpu}
              onChange={(e) => handleMetricChange('cpu', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              min={0} max={100}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Memory (%)</label>
            <input
              type="number"
              value={metrics.memory}
              onChange={(e) => handleMetricChange('memory', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              min={0} max={100}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Storage (%)</label>
            <input
              type="number"
              value={metrics.storage}
              onChange={(e) => handleMetricChange('storage', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              min={0} max={100}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Connections</label>
            <input
              type="number"
              value={metrics.connections}
              onChange={(e) => handleMetricChange('connections', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              min={0}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Max Connections</label>
            <input
              type="number"
              value={metrics.maxConnections}
              onChange={(e) => handleMetricChange('maxConnections', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              min={1}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Latency (ms)</label>
            <input
              type="number"
              value={metrics.latency}
              onChange={(e) => handleMetricChange('latency', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              min={0}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Throughput (qps)</label>
            <input
              type="number"
              value={metrics.throughput}
              onChange={(e) => handleMetricChange('throughput', e.target.value)}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              min={0}
            />
          </div>

          {/* Type-specific custom metric input */}
          {currentProfile?.customMetric && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {currentProfile.customMetric.displayName} ({currentProfile.customMetric.unit})
              </label>
              <input
                type="number"
                value={currentCustomValues[currentProfile.customMetric.key] ?? 0}
                onChange={(e) => handleCustomMetricChange(currentProfile.customMetric!.key, e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                min={0}
                step={currentProfile.customMetric.unit === 's' ? 1 : 0.1}
              />
            </div>
          )}
        </div>

        {/* Score result */}
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Overall Health Score</span>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{breakdown.overallScore}</span>
              <span className={cn('text-sm font-semibold px-2 py-0.5 rounded capitalize', statusColors[healthStatus])}>
                {healthStatus}
              </span>
            </div>
          </div>

          {/* Breakdown table */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 font-medium">Metric</th>
                <th className="py-2 font-medium text-right">Raw Value</th>
                <th className="py-2 font-medium text-right">Sub-Score</th>
                <th className="py-2 font-medium text-right">Weight</th>
                <th className="py-2 font-medium text-right">Contribution</th>
                <th className="py-2 font-medium text-center">Band</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(breakdown.metricScores) as ScoringMetric[]).map((metric) => {
                const detail = breakdown.metricScores[metric];
                return (
                  <tr key={metric} className="border-b">
                    <td className="py-2">{METRIC_LABELS[metric]}</td>
                    <td className="py-2 text-right tabular-nums">{detail.rawValue.toFixed(0)}</td>
                    <td className="py-2 text-right tabular-nums">{detail.subScore}</td>
                    <td className="py-2 text-right tabular-nums">{detail.weight.toFixed(2)}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{detail.weightedContribution.toFixed(1)}</td>
                    <td className="py-2 text-center">
                      <span className={cn('text-xs px-2 py-0.5 rounded', getBandColorClass(detail.subScore))}>
                        {detail.band}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {/* Custom metric row */}
              {breakdown.customMetricScore && (
                <tr className="border-b last:border-0 bg-muted/30">
                  <td className="py-2 font-medium">{breakdown.customMetricScore.displayName}</td>
                  <td className="py-2 text-right tabular-nums">{breakdown.customMetricScore.rawValue.toFixed(1)}</td>
                  <td className="py-2 text-right tabular-nums">{breakdown.customMetricScore.subScore}</td>
                  <td className="py-2 text-right tabular-nums">{breakdown.customMetricScore.weight.toFixed(2)}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{breakdown.customMetricScore.weightedContribution.toFixed(1)}</td>
                  <td className="py-2 text-center">
                    <span className={cn('text-xs px-2 py-0.5 rounded', getBandColorClass(breakdown.customMetricScore.subScore))}>
                      {breakdown.customMetricScore.band}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
