import type { HealthStatus } from '@/types';
import { getHealthColor } from '@/constants/health-thresholds';
import { cn } from '@/lib/utils';

interface HealthBadgeProps {
  status: HealthStatus;
  score?: number;
  size?: 'sm' | 'md' | 'lg';
  showScore?: boolean;
  className?: string;
}

export function HealthBadge({
  status,
  score,
  size = 'md',
  showScore = false,
  className,
}: HealthBadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  const statusLabels = {
    excellent: 'Excellent',
    good: 'Good',
    warning: 'Warning',
    critical: 'Critical',
    unknown: 'Unknown',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        getHealthColor(status),
        sizeClasses[size],
        className
      )}
      title={score !== undefined ? `Health Score: ${score}` : undefined}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-75',
            status === 'critical' && 'animate-ping'
          )}
        />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      <span>
        {statusLabels[status]}
        {showScore && score !== undefined && score >= 0 && ` (${score})`}
      </span>
    </span>
  );
}
