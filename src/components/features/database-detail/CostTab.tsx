import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { formatCurrency } from '@/lib/formatters';
import { ArrowUp, ArrowDown, TrendingUp, AlertTriangle, DollarSign, PieChart as PieChartIcon } from 'lucide-react';
import { getCostByDatabaseId, mockData } from '@/data/mock-data';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Database } from '@/types';
import type { TimeRange } from '@/hooks/useTimeRange';

interface CostTabProps {
  database: Database;
  timeRange: TimeRange;
}

export function CostTab({ database, timeRange }: CostTabProps) {
  const costData = useMemo(() => getCostByDatabaseId(database.id), [database.id]);

  const costAnomalies = useMemo(() => {
    return mockData.billing.anomalies.filter(
      (anomaly) =>
        anomaly.databaseId === database.id &&
        anomaly.detectedAt >= timeRange.start &&
        anomaly.detectedAt <= timeRange.end
    );
  }, [database.id, timeRange]);

  const getTrendIcon = (trend: string) => {
    if (trend === 'up') return <ArrowUp className="h-4 w-4" />;
    if (trend === 'down') return <ArrowDown className="h-4 w-4" />;
    return <TrendingUp className="h-4 w-4" />;
  };

  const getTrendColor = (trend: string) => {
    if (trend === 'up') return 'text-red-600 dark:text-red-400';
    if (trend === 'down') return 'text-green-600 dark:text-green-400';
    return 'text-muted-foreground';
  };

  const getTrendText = (trend: string) => {
    if (trend === 'up') return '+12% vs last month';
    if (trend === 'down') return '-8% vs last month';
    return 'Stable';
  };

  const costPerDay = database.monthlyCost / 30;

  return (
    <div className="space-y-6">
      {/* Monthly Cost Overview */}
      <Card className="p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold mb-1">Monthly Cost</h2>
            <p className="text-sm text-muted-foreground">Current billing period</p>
          </div>
          <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3">
            <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-4xl font-bold">{formatCurrency(database.monthlyCost)}</span>
              <span className="text-lg text-muted-foreground">/ month</span>
            </div>
            <div className={cn('flex items-center gap-1 text-sm font-medium', getTrendColor(database.costTrend))}>
              {getTrendIcon(database.costTrend)}
              <span>{getTrendText(database.costTrend)}</span>
            </div>
          </div>

          <div className="pt-4 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Cost per day</span>
              <span className="font-semibold">{formatCurrency(costPerDay)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Cost Breakdown */}
      {costData && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <PieChartIcon className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Cost Breakdown</h2>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-orange-500" />
                <span className="text-sm font-medium">Compute</span>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(costData.breakdown.compute)}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round((costData.breakdown.compute / costData.totalCost) * 100)}%
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-blue-500" />
                <span className="text-sm font-medium">Storage</span>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(costData.breakdown.storage)}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round((costData.breakdown.storage / costData.totalCost) * 100)}%
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="text-sm font-medium">Backup</span>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(costData.breakdown.backup)}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round((costData.breakdown.backup / costData.totalCost) * 100)}%
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-purple-500" />
                <span className="text-sm font-medium">Data Transfer</span>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(costData.breakdown.dataTransfer)}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round((costData.breakdown.dataTransfer / costData.totalCost) * 100)}%
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <div className="h-3 w-3 rounded-full bg-gray-500" />
                <span className="text-sm font-medium">Other</span>
              </div>
              <div className="text-right">
                <div className="font-semibold">{formatCurrency(costData.breakdown.other)}</div>
                <div className="text-xs text-muted-foreground">
                  {Math.round((costData.breakdown.other / costData.totalCost) * 100)}%
                </div>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Cost Forecast */}
      {costData && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Cost Forecast</h2>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">Next month estimate</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold">{formatCurrency(costData.forecast.nextMonth)}</span>
                <span className={cn('text-sm font-medium', getTrendColor(costData.trend.direction))}>
                  ({costData.trend.change > 0 ? '+' : ''}{costData.trend.change}%)
                </span>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Confidence</span>
                <span className="font-semibold">{costData.forecast.confidence}%</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Based on current growth trend of {costData.trend.change > 0 ? '+' : ''}{costData.trend.change}%
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Cost Anomalies */}
      {costAnomalies.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <h2 className="text-lg font-semibold">Cost Anomalies</h2>
          </div>

          <div className="space-y-3">
            {costAnomalies.map((anomaly) => (
              <div key={anomaly.id} className="p-4 rounded-lg border bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/30">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-1">
                      <h3 className="font-semibold text-red-900 dark:text-red-100 capitalize">
                        {anomaly.type.replace('_', ' ')}
                      </h3>
                      <span className="text-sm text-red-700 dark:text-red-300">
                        {format(anomaly.detectedAt, 'MMM d, yyyy')}
                      </span>
                    </div>
                    <p className="text-sm text-red-800 dark:text-red-200 mb-2">
                      {formatCurrency(anomaly.baseline)} → {formatCurrency(anomaly.amount)}
                      <span className="font-semibold ml-1">
                        (+{Math.round(((anomaly.amount - anomaly.baseline) / anomaly.baseline) * 100)}%)
                      </span>
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300">{anomaly.explanation}</p>

                    {anomaly.possibleCauses && anomaly.possibleCauses.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-red-200 dark:border-red-900/30">
                        <p className="text-xs font-semibold text-red-900 dark:text-red-100 mb-1">
                          Possible causes:
                        </p>
                        <ul className="text-xs text-red-700 dark:text-red-300 space-y-1">
                          {anomaly.possibleCauses.map((cause, idx) => (
                            <li key={idx}>• {cause}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {costAnomalies.length === 0 && (
        <Card className="p-6">
          <div className="text-center py-8">
            <p className="text-muted-foreground">No cost anomalies detected in the selected time range</p>
          </div>
        </Card>
      )}
    </div>
  );
}
