import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HealthBadge } from '@/components/common/HealthBadge';
import { formatDistanceToNow, format } from 'date-fns';
import { ArrowUp, ArrowDown, Minus, CheckCircle2, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { getAlertsByDatabaseId } from '@/data/mock-data';
import { cn } from '@/lib/utils';
import type { Database } from '@/types';
import type { TimeRange } from '@/hooks/useTimeRange';

interface OverviewTabProps {
  database: Database;
  timeRange: TimeRange;
}

export function OverviewTab({ database, timeRange }: OverviewTabProps) {
  const recentAlerts = useMemo(() => {
    const alerts = getAlertsByDatabaseId(database.id);
    return alerts
      .filter((alert) => alert.timestamp >= timeRange.start && alert.timestamp <= timeRange.end)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5);
  }, [database.id, timeRange]);

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <ArrowUp className="h-4 w-4" />;
    if (trend === 'down') return <ArrowDown className="h-4 w-4" />;
    return <Minus className="h-4 w-4" />;
  };

  const getTrendColor = (trend: string) => {
    if (trend === 'stable') return 'text-muted-foreground';
    if (trend === 'up') return 'text-green-600 dark:text-green-400';
    if (trend === 'down') return 'text-red-600 dark:text-red-400';
    return 'text-muted-foreground';
  };

  const getMetricStatus = (value: number, thresholds: { warning: number; critical: number }) => {
    if (value >= thresholds.critical) return { label: 'Critical', color: 'text-red-600 dark:text-red-400', icon: XCircle };
    if (value >= thresholds.warning) return { label: 'Warning', color: 'text-yellow-600 dark:text-yellow-400', icon: AlertTriangle };
    return { label: 'Normal', color: 'text-green-600 dark:text-green-400', icon: CheckCircle2 };
  };

  const cpuStatus = getMetricStatus(database.metrics.cpu, { warning: 70, critical: 85 });
  const memoryStatus = getMetricStatus(database.metrics.memory, { warning: 70, critical: 85 });
  const storageStatus = getMetricStatus(database.metrics.storage, { warning: 70, critical: 85 });

  return (
    <div className="space-y-6">
      {/* Database Information */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Database Information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Database Type</p>
            <p className="font-medium capitalize">{database.type}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Cloud Provider</p>
            <p className="font-medium">{database.cloud.toUpperCase()}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Region</p>
            <p className="font-medium">{database.region}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Environment</p>
            <Badge variant="outline" className="capitalize">
              {database.environment}
            </Badge>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Created</p>
            <p className="font-medium">
              {formatDistanceToNow(database.createdAt, { addSuffix: true })}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">Last Checked</p>
            <p className="font-medium">
              {formatDistanceToNow(database.lastChecked, { addSuffix: true })}
            </p>
          </div>
        </div>

        {/* Tags */}
        {Object.keys(database.tags).length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <p className="text-sm text-muted-foreground mb-2">Tags</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(database.tags).map(([key, value]) => (
                <Badge key={key} variant="secondary" className="font-normal">
                  <span className="text-muted-foreground">{key}:</span>
                  <span className="ml-1">{value}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Current Health Status */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">Current Health Status</h2>

        <div className="flex items-center gap-4 mb-6">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Overall Health</p>
            <div className="flex items-center gap-3">
              <span className="text-4xl font-bold">
                {database.healthScore >= 0 ? database.healthScore : '—'}
              </span>
              <div className="flex flex-col gap-1">
                <HealthBadge status={database.healthStatus} size="sm" />
                <div className={cn('flex items-center gap-1 text-xs font-medium', getTrendColor(database.healthTrend))}>
                  {getTrendIcon(database.healthTrend)}
                  <span className="capitalize">{database.healthTrend}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Health Factors */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground">Health Factors</h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* CPU */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="flex items-center gap-2">
                <cpuStatus.icon className={cn('h-4 w-4', cpuStatus.color)} />
                <span className="text-sm font-medium">CPU Usage</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{database.metrics.cpu}%</span>
                <span className={cn('text-xs', cpuStatus.color)}>{cpuStatus.label}</span>
              </div>
            </div>

            {/* Memory */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="flex items-center gap-2">
                <memoryStatus.icon className={cn('h-4 w-4', memoryStatus.color)} />
                <span className="text-sm font-medium">Memory Usage</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{database.metrics.memory}%</span>
                <span className={cn('text-xs', memoryStatus.color)}>{memoryStatus.label}</span>
              </div>
            </div>

            {/* Storage */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="flex items-center gap-2">
                <storageStatus.icon className={cn('h-4 w-4', storageStatus.color)} />
                <span className="text-sm font-medium">Storage Usage</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{database.metrics.storage}%</span>
                <span className={cn('text-xs', storageStatus.color)}>{storageStatus.label}</span>
              </div>
            </div>

            {/* Connections */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium">Connection Pool</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{database.metrics.connections}/{database.metrics.maxConnections}</span>
                <span className="text-xs text-green-600 dark:text-green-400">Healthy</span>
              </div>
            </div>

            {/* Latency */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium">Latency</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{database.metrics.latency}ms</span>
                <span className="text-xs text-green-600 dark:text-green-400">Excellent</span>
              </div>
            </div>

            {/* Throughput */}
            <div className="flex items-center justify-between p-3 rounded-lg border bg-card">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium">Throughput</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{database.metrics.throughput} qps</span>
                <span className="text-xs text-green-600 dark:text-green-400">Normal</span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Recent Activity */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
          <Link
            to={`/alerts?database=${database.id}`}
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            View all alerts
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {recentAlerts.length > 0 ? (
          <div className="space-y-3">
            {recentAlerts.map((alert) => (
              <div key={alert.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
                <div className={cn(
                  'rounded-full p-1.5 mt-0.5',
                  alert.severity === 'critical' && 'bg-red-100 dark:bg-red-900/30',
                  alert.severity === 'warning' && 'bg-yellow-100 dark:bg-yellow-900/30',
                  alert.severity === 'info' && 'bg-blue-100 dark:bg-blue-900/30'
                )}>
                  <AlertTriangle className={cn(
                    'h-3.5 w-3.5',
                    alert.severity === 'critical' && 'text-red-600 dark:text-red-400',
                    alert.severity === 'warning' && 'text-yellow-600 dark:text-yellow-400',
                    alert.severity === 'info' && 'text-blue-600 dark:text-blue-400'
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{alert.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(alert.timestamp, 'MMM d, yyyy h:mm a')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">No recent activity in the selected time range</p>
          </div>
        )}
      </Card>
    </div>
  );
}
