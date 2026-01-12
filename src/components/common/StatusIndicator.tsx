import { cn } from '@/lib/utils';

interface StatusIndicatorProps {
  status: 'success' | 'warning' | 'error' | 'info';
  label?: string;
  pulse?: boolean;
  className?: string;
}

export function StatusIndicator({ status, label, pulse = false, className }: StatusIndicatorProps) {
  const statusColors = {
    success: 'bg-green-500',
    warning: 'bg-amber-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="relative flex h-3 w-3">
        {pulse && (
          <span
            className={cn(
              'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping',
              statusColors[status]
            )}
          />
        )}
        <span className={cn('relative inline-flex h-3 w-3 rounded-full', statusColors[status])} />
      </span>
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}
