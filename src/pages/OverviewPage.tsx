import { useMemo, useState } from 'react';
import { mockData } from '@/data/mock-data';
import { ExecutiveSummary } from '@/components/features/overview/ExecutiveSummary';
import { DatabaseGrid } from '@/components/features/overview/DatabaseGrid';
import { CloudProviderCard } from '@/components/features/overview/CloudProviderCard';
import { aggregateDatabasesByCloud } from '@/utils/aggregation';
import { useTimeRange, type TimeRangeOption } from '@/hooks/useTimeRange';
import { formatCurrency } from '@/lib/formatters';
import { useScoredDatabases } from '@/hooks/useScoredDatabases';

const TIME_RANGE_OPTIONS: { value: TimeRangeOption; label: string }[] = [
  { value: '1h', label: 'Last 1 Hour' },
  { value: '3h', label: 'Last 3 Hours' },
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last Week' },
  { value: 'custom', label: 'Custom Range' },
];

export function OverviewPage() {
  const { timeRange, setTimeRange } = useTimeRange('24h');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Apply scoring config to databases
  const databases = useScoredDatabases(mockData.databases);

  // Calculate summary statistics
  const summary = useMemo(() => {
    const totalDatabases = databases.length;
    const healthyDatabases = databases.filter(
      db => db.healthStatus === 'excellent' || db.healthStatus === 'good'
    ).length;
    const warningDatabases = databases.filter(
      db => db.healthStatus === 'warning'
    ).length;
    const criticalDatabases = databases.filter(
      db => db.healthStatus === 'critical'
    ).length;
    const totalCost = databases.reduce(
      (sum, db) => sum + db.monthlyCost,
      0
    );
    const activeIssues = mockData.issues.filter(
      issue => issue.status === 'active'
    ).length;

    return {
      totalDatabases,
      healthyDatabases,
      warningDatabases,
      criticalDatabases,
      totalCost,
      activeIssues,
    };
  }, [databases]);

  // Aggregate databases by cloud and region
  const cloudAggregates = useMemo(() => {
    return aggregateDatabasesByCloud(databases);
  }, [databases]);

  // Count unique cloud providers
  const cloudProviderCount = cloudAggregates.length;

  return (
    <div className="space-y-8">
      {/* Page Title with Timeframe Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Database Overview</h1>
          <p className="text-muted-foreground mt-2">
            Monitor fleet health across cloud providers and regions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={timeRange.value}
            onChange={(e) => setTimeRange(e.target.value as TimeRangeOption)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {TIME_RANGE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {timeRange.value === 'custom' && (
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-sm text-muted-foreground">to</span>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-md border border-input bg-background px-2 py-1.5 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
        </div>
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary {...summary} />

      {/* Summary Statement */}
      <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg px-4 py-3">
        Monitoring {summary.totalDatabases} databases across {cloudProviderCount} cloud provider{cloudProviderCount !== 1 ? 's' : ''}.{' '}
        {summary.healthyDatabases} healthy, {summary.warningDatabases} with warnings, {summary.criticalDatabases} critical.{' '}
        Total monthly spend: {formatCurrency(summary.totalCost)} with {summary.activeIssues} active issue{summary.activeIssues !== 1 ? 's' : ''}.
      </p>

      {/* Fleet Health by Cloud Provider */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            Fleet Health by Cloud Provider
          </h2>
          <div className="text-sm text-muted-foreground">
            {cloudAggregates.length} cloud provider{cloudAggregates.length !== 1 ? 's' : ''}
          </div>
        </div>
        <div className="space-y-4">
          {cloudAggregates.map((aggregate) => (
            <CloudProviderCard
              key={aggregate.cloud}
              cloudAggregate={aggregate}
              defaultExpanded={aggregate.criticalCount > 0}
            />
          ))}
        </div>
      </div>

      {/* Database Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">All Databases ({summary.totalDatabases})</h2>
        </div>
        <DatabaseGrid databases={databases} />
      </div>
    </div>
  );
}
