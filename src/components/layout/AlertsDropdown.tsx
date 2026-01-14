import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, AlertTriangle, Info, Clock, ArrowRight, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/formatters';
import { mockData } from '@/data/mock-data';
import type { AlertSeverity } from '@/types';

interface AlertsDropdownProps {
  onClose: () => void;
}

export function AlertsDropdown({ onClose }: AlertsDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Get recent unread alerts (max 5)
  const recentAlerts = mockData.alerts
    .filter((alert) => alert.status === 'unread')
    .slice(0, 5);

  const unreadCount = mockData.alerts.filter((a) => a.status === 'unread').length;

  const getSeverityIcon = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="h-4 w-4" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4" />;
      case 'info':
        return <Info className="h-4 w-4" />;
    }
  };

  const getSeverityColor = (severity: AlertSeverity) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 dark:text-red-400';
      case 'warning':
        return 'text-amber-600 dark:text-amber-400';
      case 'info':
        return 'text-blue-600 dark:text-blue-400';
    }
  };

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full mt-2 w-96 rounded-lg border bg-background shadow-lg z-50"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h3 className="font-semibold">Notifications</h3>
          <p className="text-xs text-muted-foreground">
            {unreadCount} unread alert{unreadCount !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          to="/alerts"
          onClick={onClose}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          View All
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {/* Alerts List */}
      <div className="max-h-96 overflow-y-auto">
        {recentAlerts.length === 0 ? (
          <div className="p-8 text-center">
            <div className="flex justify-center mb-2">
              <CheckCheck className="h-8 w-8 text-green-500" />
            </div>
            <p className="text-sm font-medium">All caught up!</p>
            <p className="text-xs text-muted-foreground mt-1">No new alerts</p>
          </div>
        ) : (
          <div className="divide-y">
            {recentAlerts.map((alert) => (
              <Link
                key={alert.id}
                to="/alerts"
                onClick={onClose}
                className="block p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={cn('flex-shrink-0 mt-0.5', getSeverityColor(alert.severity))}>
                    {getSeverityIcon(alert.severity)}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium line-clamp-1">{alert.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {alert.message}
                    </p>

                    {/* Metadata */}
                    <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                      <span className="font-medium">{alert.databaseName}</span>
                      <span>•</span>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        <span>{formatTimeAgo(alert.timestamp)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Unread indicator */}
                  <div className="flex-shrink-0">
                    <span className="w-2 h-2 rounded-full bg-blue-500 block"></span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {recentAlerts.length > 0 && (
        <div className="p-3 border-t bg-muted/30">
          <Link
            to="/alerts"
            onClick={onClose}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-lg hover:bg-muted transition-colors"
          >
            View All Alerts
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}
    </div>
  );
}
