import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Trend } from '@/types';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: Trend;
  trendValue?: string;
  icon?: LucideIcon;
  iconColor?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
  trend,
  trendValue,
  icon: Icon,
  iconColor = 'text-blue-500',
  className,
}: MetricCardProps) {
  const getTrendIcon = () => {
    if (!trend) return null;

    switch (trend) {
      case 'up':
        return <TrendingUp className="h-4 w-4 text-green-500" />;
      case 'down':
        return <TrendingDown className="h-4 w-4 text-red-500" />;
      case 'stable':
        return <Minus className="h-4 w-4 text-gray-400" />;
    }
  };

  const getTrendColor = () => {
    switch (trend) {
      case 'up':
        return 'text-green-600';
      case 'down':
        return 'text-red-600';
      case 'stable':
        return 'text-gray-500';
      default:
        return '';
    }
  };

  return (
    <div
      className={cn(
        'rounded-lg border bg-card p-6 shadow-sm hover:shadow-md transition-shadow',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {Icon && <Icon className={cn('h-5 w-5', iconColor)} />}
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <p className="text-2xl font-bold">{value}</p>

        {trend && (
          <div className="flex items-center gap-1">
            {getTrendIcon()}
            {trendValue && (
              <span className={cn('text-sm font-medium', getTrendColor())}>
                {trendValue}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
