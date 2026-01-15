import { cn } from '@/lib/utils';
import { getHealthColor } from '@/utils/aggregation';

interface HealthProgressBarProps {
  healthScore: number;
  size?: 'sm' | 'md';
}

export function HealthProgressBar({ healthScore, size = 'md' }: HealthProgressBarProps) {
  const percentage = Math.round(healthScore);
  const color = getHealthColor(healthScore);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Health</span>
        <span className="font-medium">{percentage}%</span>
      </div>
      <div
        className={cn(
          'w-full bg-muted rounded-full overflow-hidden',
          size === 'sm' ? 'h-1.5' : 'h-2'
        )}
      >
        <div
          className={cn('h-full transition-all duration-300', color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
