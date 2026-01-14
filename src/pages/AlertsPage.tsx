import { useState, useMemo } from 'react';
import { AlertsFilters } from '@/components/features/alerts/AlertsFilters';
import { AlertsList } from '@/components/features/alerts/AlertsList';
import { mockData } from '@/data/mock-data';
import { Bell } from 'lucide-react';
import type { Alert, AlertSeverity, AlertType, AlertStatus } from '@/types';

export function AlertsPage() {
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<AlertType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AlertStatus | 'all'>('all');
  const [alertsData, setAlertsData] = useState<Alert[]>(mockData.alerts);

  // Filter alerts
  const filteredAlerts = useMemo(() => {
    let filtered = alertsData;

    // Severity filter
    if (severityFilter !== 'all') {
      filtered = filtered.filter((alert) => alert.severity === severityFilter);
    }

    // Type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter((alert) => alert.type === typeFilter);
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((alert) => alert.status === statusFilter);
    }

    return filtered;
  }, [alertsData, severityFilter, typeFilter, statusFilter]);

  // Calculate counts
  const counts = useMemo(() => {
    return {
      total: alertsData.length,
      unread: alertsData.filter((a) => a.status === 'unread').length,
      critical: alertsData.filter((a) => a.severity === 'critical').length,
    };
  }, [alertsData]);

  const handleClearFilters = () => {
    setSeverityFilter('all');
    setTypeFilter('all');
    setStatusFilter('all');
  };

  const handleMarkAsRead = (alertId: string) => {
    setAlertsData((prev) =>
      prev.map((alert) =>
        alert.id === alertId ? { ...alert, status: 'read' as AlertStatus } : alert
      )
    );
  };

  const handleDismiss = (alertId: string) => {
    setAlertsData((prev) =>
      prev.map((alert) =>
        alert.id === alertId ? { ...alert, status: 'dismissed' as AlertStatus } : alert
      )
    );
  };

  const hasActiveFilters = severityFilter !== 'all' || typeFilter !== 'all' || statusFilter !== 'all';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Bell className="h-8 w-8" />
          Alerts & Notifications
        </h1>
        <p className="text-muted-foreground mt-1">
          Stay informed about critical events and system notifications
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card border rounded-lg p-4">
          <p className="text-sm text-muted-foreground mb-1">Total Alerts</p>
          <p className="text-3xl font-bold">{counts.total}</p>
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-muted-foreground mb-1">Unread</p>
          <div className="flex items-center gap-2">
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{counts.unread}</p>
            {counts.unread > 0 && (
              <span className="w-3 h-3 rounded-full bg-blue-600 dark:bg-blue-400 animate-pulse"></span>
            )}
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-sm text-muted-foreground mb-1">Critical</p>
          <p className="text-3xl font-bold text-red-600 dark:text-red-400">{counts.critical}</p>
        </div>
      </div>

      {/* Filters */}
      <AlertsFilters
        severityFilter={severityFilter}
        typeFilter={typeFilter}
        statusFilter={statusFilter}
        onSeverityChange={setSeverityFilter}
        onTypeChange={setTypeFilter}
        onStatusChange={setStatusFilter}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {filteredAlerts.length} of {counts.total} alerts
        </p>
      </div>

      {/* Alerts List */}
      <AlertsList
        alerts={filteredAlerts}
        onMarkAsRead={handleMarkAsRead}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
