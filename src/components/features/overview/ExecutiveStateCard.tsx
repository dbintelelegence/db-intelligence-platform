import { Card } from '@/components/ui/card';
import { AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Database } from '@/types';

interface ExecutiveStateCardProps {
  databases: Database[];
}

export function ExecutiveStateCard({ databases }: ExecutiveStateCardProps) {
  const criticalCount = databases.filter(
    (db) => db.healthStatus === 'critical'
  ).length;
  const warningCount = databases.filter(
    (db) => db.healthStatus === 'warning'
  ).length;
  const degradedCount = criticalCount + warningCount;

  // Determine overall state
  let stateMessage: string;
  let stateDetails: string;
  let stateIcon: React.ReactNode;
  let stateColor: string;

  if (criticalCount > 0) {
    stateMessage = 'Your database platform requires immediate attention.';
    stateDetails = `${criticalCount} database${criticalCount !== 1 ? 's' : ''} in critical state.`;
    stateIcon = <AlertCircle className="h-16 w-16 text-red-500" />;
    stateColor = 'text-red-700 dark:text-red-400';
  } else if (warningCount > 0) {
    stateMessage = 'Your database platform is mostly healthy.';
    stateDetails = `${warningCount} database${warningCount !== 1 ? 's' : ''} require${warningCount === 1 ? 's' : ''} attention.`;
    stateIcon = <AlertTriangle className="h-16 w-16 text-yellow-500" />;
    stateColor = 'text-yellow-700 dark:text-yellow-400';
  } else {
    stateMessage = 'Your database platform is stable.';
    stateDetails = 'No critical issues detected in the last 24 hours.';
    stateIcon = <CheckCircle className="h-16 w-16 text-green-500" />;
    stateColor = 'text-green-700 dark:text-green-400';
  }

  return (
    <Card className="p-12 text-center">
      {/* Icon */}
      <div className="flex justify-center mb-6">{stateIcon}</div>

      {/* Main State Message */}
      <h2 className={cn('text-4xl font-bold mb-4', stateColor)}>
        {stateMessage}
      </h2>

      {/* Details */}
      <p className="text-2xl text-muted-foreground">{stateDetails}</p>

      {/* Optional: Show degraded count if both critical and warning exist */}
      {criticalCount > 0 && warningCount > 0 && (
        <p className="text-lg text-muted-foreground mt-2">
          Total degraded: {degradedCount} databases
        </p>
      )}
    </Card>
  );
}
