import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { HealthBadge } from '@/components/common/HealthBadge';
import { formatCurrency } from '@/lib/formatters';
import { Heart, AlertCircle, DollarSign, GitCommit, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { getIssuesByDatabaseId } from '@/data/mock-data';
import type { Database } from '@/types';

interface DatabaseSummaryCardsProps {
  database: Database;
}

export function DatabaseSummaryCards({ database }: DatabaseSummaryCardsProps) {
  const issues = useMemo(
    () => getIssuesByDatabaseId(database.id),
    [database.id]
  );

  const criticalIssues = issues.filter((i) => i.severity === 'critical').length;

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <ArrowUp className="h-3.5 w-3.5" />;
    if (trend === 'down') return <ArrowDown className="h-3.5 w-3.5" />;
    return <Minus className="h-3.5 w-3.5" />;
  };

  const getTrendColor = (trend: string, isInverted = false) => {
    if (trend === 'stable') return 'text-muted-foreground';
    if (trend === 'up') return isInverted ? 'text-red-600' : 'text-green-600';
    if (trend === 'down') return isInverted ? 'text-green-600' : 'text-red-600';
    return 'text-muted-foreground';
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Health Score Card */}
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Health Score</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{database.healthScore >= 0 ? database.healthScore : '—'}</span>
              {database.healthScore >= 0 && (
                <span className="text-sm text-muted-foreground">/ 100</span>
              )}
            </div>
          </div>
          <div className="rounded-full bg-primary/10 p-2.5">
            <Heart className="h-4 w-4 text-primary" />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <HealthBadge status={database.healthStatus} size="sm" />
          <div className={`flex items-center gap-1 text-xs font-medium ${getTrendColor(database.healthTrend)}`}>
            {getTrendIcon(database.healthTrend)}
            <span className="capitalize">{database.healthTrend}</span>
          </div>
        </div>
      </Card>

      {/* Active Issues Card */}
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Active Issues</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{database.activeIssues}</span>
              {database.activeIssues > 0 && (
                <span className="text-sm text-muted-foreground">total</span>
              )}
            </div>
          </div>
          <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-2.5">
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
        </div>
        <div className="mt-3">
          {criticalIssues > 0 ? (
            <div className="flex items-center gap-2 text-xs">
              <div className="h-2 w-2 rounded-full bg-red-500" />
              <span className="text-red-600 dark:text-red-400 font-medium">
                {criticalIssues} critical
              </span>
            </div>
          ) : database.activeIssues > 0 ? (
            <p className="text-xs text-muted-foreground">No critical issues</p>
          ) : (
            <p className="text-xs text-muted-foreground">No issues found</p>
          )}
        </div>
      </Card>

      {/* Monthly Cost Card */}
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Monthly Cost</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{formatCurrency(database.monthlyCost)}</span>
              <span className="text-sm text-muted-foreground">/ mo</span>
            </div>
          </div>
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-2.5">
            <DollarSign className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
        </div>
        <div className="mt-3">
          <div className={`flex items-center gap-1 text-xs font-medium ${getTrendColor(database.costTrend, true)}`}>
            {getTrendIcon(database.costTrend)}
            <span>
              {database.costTrend === 'up' && '+12%'}
              {database.costTrend === 'down' && '-8%'}
              {database.costTrend === 'stable' && 'Stable'}
            </span>
            <span className="text-muted-foreground ml-1">vs last month</span>
          </div>
        </div>
      </Card>

      {/* Recent Changes Card */}
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">Recent Changes</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{database.recentChanges}</span>
              {database.recentChanges > 0 && (
                <span className="text-sm text-muted-foreground">events</span>
              )}
            </div>
          </div>
          <div className="rounded-full bg-blue-100 dark:bg-blue-900/30 p-2.5">
            <GitCommit className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">
            {database.recentChanges > 0 ? 'Last 24 hours' : 'No recent changes'}
          </p>
        </div>
      </Card>
    </div>
  );
}
