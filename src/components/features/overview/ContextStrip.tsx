import { Card } from '@/components/ui/card';
import type { Database } from '@/types';
import { cn } from '@/lib/utils';

interface ContextStripProps {
  databases: Database[];
}

export function ContextStrip({ databases }: ContextStripProps) {
  const totalCount = databases.length;
  const healthyCount = databases.filter(
    (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
  ).length;
  const degradedCount = databases.filter(
    (db) => db.healthStatus === 'warning'
  ).length;
  const criticalCount = databases.filter(
    (db) => db.healthStatus === 'critical'
  ).length;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-sm">
        {/* Total */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Total databases:</span>
          <span className="font-semibold text-lg">{totalCount}</span>
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-border" />

        {/* Healthy */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Healthy:</span>
          <span className="font-semibold text-lg text-green-600 dark:text-green-400">
            {healthyCount}
          </span>
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-border" />

        {/* Degraded */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Degraded:</span>
          <span
            className={cn(
              'font-semibold text-lg',
              degradedCount > 0
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-muted-foreground'
            )}
          >
            {degradedCount}
          </span>
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-border" />

        {/* Critical */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Critical:</span>
          <span
            className={cn(
              'font-semibold text-lg',
              criticalCount > 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-muted-foreground'
            )}
          >
            {criticalCount}
          </span>
        </div>

        {/* Separator */}
        <div className="hidden sm:block h-6 w-px bg-border" />

        {/* Time Range */}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Time range:</span>
          <span className="font-medium">Last 24 hours</span>
        </div>
      </div>
    </Card>
  );
}
