import { AlertCard } from './AlertCard';
import type { Alert } from '@/types';

interface AlertsListProps {
  alerts: Alert[];
  onMarkAsRead?: (alertId: string) => void;
  onDismiss?: (alertId: string) => void;
}

export function AlertsList({ alerts, onMarkAsRead, onDismiss }: AlertsListProps) {
  if (alerts.length === 0) {
    return (
      <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed">
        <p className="text-muted-foreground text-lg">No alerts found</p>
        <p className="text-muted-foreground text-sm mt-1">
          Try adjusting your filters
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {alerts.map((alert) => (
        <AlertCard
          key={alert.id}
          alert={alert}
          onMarkAsRead={onMarkAsRead}
          onDismiss={onDismiss}
        />
      ))}
    </div>
  );
}
