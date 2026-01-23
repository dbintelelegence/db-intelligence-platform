import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/ui/card';
import { TrendingUp, TrendingDown, AlertTriangle, DollarSign } from 'lucide-react';
import type { Database } from '@/types';
import { cn } from '@/lib/utils';

interface CostSnapshotProps {
  databases: Database[];
}

export function CostSnapshot({ databases }: CostSnapshotProps) {
  const navigate = useNavigate();

  const costData = useMemo(() => {
    const totalCost = databases.reduce((sum, db) => sum + db.monthlyCost, 0);

    // Calculate average trend
    const trendsUp = databases.filter((db) => db.costTrend === 'up').length;
    const trendsDown = databases.filter((db) => db.costTrend === 'down').length;

    let overallTrend: 'up' | 'down' | 'stable';
    if (trendsUp > trendsDown * 1.5) {
      overallTrend = 'up';
    } else if (trendsDown > trendsUp * 1.5) {
      overallTrend = 'down';
    } else {
      overallTrend = 'stable';
    }

    // Calculate simulated percentage change
    const percentageChange =
      overallTrend === 'up'
        ? Math.floor(Math.random() * 15) + 5 // 5-20% increase
        : overallTrend === 'down'
          ? -(Math.floor(Math.random() * 10) + 3) // 3-13% decrease
          : Math.floor(Math.random() * 5) - 2; // -2 to +3%

    // Check for anomaly (>10% increase)
    const hasAnomaly = percentageChange > 10;

    // Find region with highest cost increase
    const regionCosts = new Map<string, number>();
    databases.forEach((db) => {
      const current = regionCosts.get(db.region) || 0;
      regionCosts.set(db.region, current + db.monthlyCost);
    });
    const topRegion = Array.from(regionCosts.entries()).sort(
      (a, b) => b[1] - a[1]
    )[0]?.[0];

    return {
      totalCost,
      percentageChange,
      overallTrend,
      hasAnomaly,
      topRegion,
    };
  }, [databases]);

  return (
    <Card
      className={cn(
        'p-6 cursor-pointer hover:bg-muted/30 transition-colors',
        costData.hasAnomaly && 'border-yellow-500 dark:border-yellow-600'
      )}
      onClick={() => navigate('/billing')}
    >
      <div className="flex items-center justify-between">
        {/* Left side - cost info */}
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
            <DollarSign className="h-6 w-6 text-primary" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">
              Database cost (last 24h)
            </div>
            <div className="flex items-baseline gap-3">
              <div className="text-2xl font-bold">
                ${costData.totalCost.toLocaleString()}
              </div>
              <div
                className={cn(
                  'flex items-center gap-1 text-sm font-medium',
                  costData.percentageChange > 0
                    ? 'text-red-600 dark:text-red-400'
                    : costData.percentageChange < 0
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-muted-foreground'
                )}
              >
                {costData.percentageChange > 0 ? (
                  <>
                    <TrendingUp className="h-4 w-4" />
                    +{costData.percentageChange}%
                  </>
                ) : costData.percentageChange < 0 ? (
                  <>
                    <TrendingDown className="h-4 w-4" />
                    {costData.percentageChange}%
                  </>
                ) : (
                  '→ stable'
                )}
                <span className="text-xs text-muted-foreground ml-1">
                  vs previous period
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right side - anomaly warning if present */}
        {costData.hasAnomaly && (
          <div className="flex items-start gap-2 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 max-w-md">
            <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-sm text-yellow-800 dark:text-yellow-200">
                Cost anomaly detected in {costData.topRegion}
              </div>
              <div className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                Increase correlated with higher write volume
              </div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
