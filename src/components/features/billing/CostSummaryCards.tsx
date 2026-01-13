import { DollarSign, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { Trend } from '@/types';

interface CostSummaryCardsProps {
  totalCost: number;
  averageCostPerDatabase: number;
  trendPercentage: number;
  trendDirection: Trend;
  anomalyCount: number;
}

export function CostSummaryCards({
  totalCost,
  averageCostPerDatabase,
  trendPercentage,
  trendDirection,
  anomalyCount,
}: CostSummaryCardsProps) {
  const getTrendIcon = () => {
    if (trendDirection === 'up') return TrendingUp;
    if (trendDirection === 'down') return TrendingDown;
    return null;
  };

  const getTrendColor = () => {
    if (trendDirection === 'up') return 'text-red-600 dark:text-red-400';
    if (trendDirection === 'down') return 'text-green-600 dark:text-green-400';
    return 'text-muted-foreground';
  };

  const TrendIcon = getTrendIcon();

  const cards = [
    {
      label: 'Total Monthly Cost',
      value: formatCurrency(totalCost),
      icon: DollarSign,
      iconColor: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-950/30',
    },
    {
      label: 'Average Cost per Database',
      value: formatCurrency(averageCostPerDatabase),
      icon: DollarSign,
      iconColor: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-950/30',
    },
    {
      label: 'Trend vs Last Period',
      value: trendDirection === 'stable' ? 'Stable' : formatPercent(Math.abs(trendPercentage)),
      icon: TrendIcon || DollarSign,
      iconColor: getTrendColor(),
      bgColor: trendDirection === 'up'
        ? 'bg-red-50 dark:bg-red-950/30'
        : trendDirection === 'down'
        ? 'bg-green-50 dark:bg-green-950/30'
        : 'bg-gray-50 dark:bg-gray-950/30',
      trend: trendDirection !== 'stable' ? {
        value: formatPercent(Math.abs(trendPercentage)),
        direction: trendDirection,
      } : undefined,
    },
    {
      label: 'Cost Anomalies',
      value: anomalyCount.toString(),
      icon: AlertTriangle,
      iconColor: anomalyCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
      bgColor: anomalyCount > 0 ? 'bg-amber-50 dark:bg-amber-950/30' : 'bg-gray-50 dark:bg-gray-950/30',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card, index) => {
        const Icon = card.icon;
        return (
          <div
            key={index}
            className={cn(
              'rounded-lg border p-6 transition-all',
              card.bgColor
            )}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  {card.label}
                </p>
                <p className="text-3xl font-bold">{card.value}</p>
                {card.trend && (
                  <div className="flex items-center gap-1 mt-2">
                    {card.trend.direction === 'up' ? (
                      <TrendingUp className="h-4 w-4 text-red-600 dark:text-red-400" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-green-600 dark:text-green-400" />
                    )}
                    <span className={cn('text-sm font-medium', getTrendColor())}>
                      {card.trend.value}
                    </span>
                  </div>
                )}
              </div>
              <div className={cn('rounded-full p-3', card.iconColor)}>
                <Icon className="h-6 w-6" />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
