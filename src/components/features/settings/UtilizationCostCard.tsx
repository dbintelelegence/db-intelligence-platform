import { useMemo } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { TrendingDown, DollarSign, AlertTriangle } from 'lucide-react';
import { mockData } from '@/data/mock-data';
import { useScoredDatabases } from '@/hooks/useScoredDatabases';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { extractScoringInputs, computeSubScore } from '@/lib/health-scoring';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ScoringMetric } from '@/types';

const METRIC_LABELS: Record<string, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  storage: 'Storage',
  connectionRatio: 'Connections',
};

/** Metrics where underutilization is meaningful */
const UTILIZATION_METRICS: ScoringMetric[] = ['cpu', 'memory', 'storage', 'connectionRatio'];

interface UnderutilizedDb {
  id: string;
  name: string;
  type: string;
  monthlyCost: number;
  underutilizedMetrics: { metric: string; value: number; band: string }[];
  estimatedSavings: number;
}

export function UtilizationCostCard() {
  const { config } = useScoringConfig();
  const databases = useScoredDatabases(mockData.databases);

  const analysis = useMemo(() => {
    const underutilized: UnderutilizedDb[] = [];

    for (const db of databases) {
      if (db.healthScore === -1) continue;

      const inputs = extractScoringInputs(db.metrics);
      const underMetrics: { metric: string; value: number; band: string }[] = [];

      for (const metric of UTILIZATION_METRICS) {
        const thresholdConfig = config.metricThresholds.find(t => t.metric === metric);
        if (!thresholdConfig?.underutilizationBands?.length) continue;

        const { band } = computeSubScore(inputs[metric], thresholdConfig);
        if (band === 'Idle' || band === 'Underutilized') {
          underMetrics.push({
            metric: METRIC_LABELS[metric] || metric,
            value: Math.round(inputs[metric]),
            band,
          });
        }
      }

      if (underMetrics.length > 0) {
        // Estimate savings: more underutilized metrics = higher potential savings
        // Idle → could rightsize by ~50%, Underutilized → ~25%
        const idleCount = underMetrics.filter(m => m.band === 'Idle').length;
        const underCount = underMetrics.filter(m => m.band === 'Underutilized').length;
        const savingsRatio = Math.min(
          (idleCount * 0.15 + underCount * 0.08),
          0.50
        );

        underutilized.push({
          id: db.id,
          name: db.name,
          type: db.type,
          monthlyCost: db.monthlyCost,
          underutilizedMetrics: underMetrics,
          estimatedSavings: db.monthlyCost * savingsRatio,
        });
      }
    }

    // Sort by estimated savings descending
    underutilized.sort((a, b) => b.estimatedSavings - a.estimatedSavings);

    const totalEstimatedSavings = underutilized.reduce((s, d) => s + d.estimatedSavings, 0);
    const totalFleetCost = databases.reduce((s, d) => s + d.monthlyCost, 0);

    return {
      underutilized,
      totalEstimatedSavings,
      totalFleetCost,
      underutilizedCount: underutilized.length,
      totalCount: databases.length,
      percentUnderutilized: databases.length > 0
        ? Math.round((underutilized.length / databases.length) * 100)
        : 0,
    };
  }, [databases, config]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingDown className="h-5 w-5 text-amber-500" />
          Utilization & Cost Optimization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border p-4 text-center space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-amber-500">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-2xl font-bold">{analysis.underutilizedCount}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Underutilized databases ({analysis.percentUnderutilized}% of fleet)
            </p>
          </div>
          <div className="rounded-lg border p-4 text-center space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-emerald-600">
              <DollarSign className="h-4 w-4" />
              <span className="text-2xl font-bold">{formatCurrency(analysis.totalEstimatedSavings)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated monthly savings
            </p>
          </div>
          <div className="rounded-lg border p-4 text-center space-y-1">
            <span className="text-2xl font-bold text-muted-foreground">{formatCurrency(analysis.totalFleetCost)}</span>
            <p className="text-xs text-muted-foreground">
              Total fleet monthly cost
            </p>
          </div>
        </div>

        {/* Top underutilized databases */}
        {analysis.underutilized.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">
              Top Underutilized Databases
              <span className="text-muted-foreground font-normal ml-1">
                (showing {Math.min(analysis.underutilized.length, 10)} of {analysis.underutilized.length})
              </span>
            </h4>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="py-2 px-3 font-medium">Database</th>
                    <th className="py-2 px-3 font-medium">Type</th>
                    <th className="py-2 px-3 font-medium">Underutilized Metrics</th>
                    <th className="py-2 px-3 font-medium text-right">Monthly Cost</th>
                    <th className="py-2 px-3 font-medium text-right">Est. Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.underutilized.slice(0, 10).map((db) => (
                    <tr key={db.id} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{db.name}</td>
                      <td className="py-2 px-3 text-muted-foreground capitalize">{db.type}</td>
                      <td className="py-2 px-3">
                        <div className="flex flex-wrap gap-1">
                          {db.underutilizedMetrics.map((m) => (
                            <span
                              key={m.metric}
                              className={cn(
                                'text-xs px-2 py-0.5 rounded',
                                m.band === 'Idle'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              )}
                            >
                              {m.metric} {m.value}%
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {formatCurrency(db.monthlyCost)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-emerald-600 font-medium">
                        {formatCurrency(db.estimatedSavings)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No underutilized databases detected. All resources are within optimal utilization ranges.
          </p>
        )}

        {/* Explanation */}
        <p className="text-xs text-muted-foreground">
          Databases with very low resource utilization (CPU, Memory, Storage, Connections below configured thresholds)
          are flagged as underutilized. These represent over-provisioned resources that could be rightsized to reduce costs.
          Underutilization also reduces the health score to surface these optimization opportunities.
        </p>
      </CardContent>
    </Card>
  );
}
