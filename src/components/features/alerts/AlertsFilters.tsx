import { X } from 'lucide-react';
import type { AlertSeverity, AlertType, AlertStatus } from '@/types';

interface AlertsFiltersProps {
  severityFilter: AlertSeverity | 'all';
  typeFilter: AlertType | 'all';
  statusFilter: AlertStatus | 'all';
  onSeverityChange: (severity: AlertSeverity | 'all') => void;
  onTypeChange: (type: AlertType | 'all') => void;
  onStatusChange: (status: AlertStatus | 'all') => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export function AlertsFilters({
  severityFilter,
  typeFilter,
  statusFilter,
  onSeverityChange,
  onTypeChange,
  onStatusChange,
  onClearFilters,
  hasActiveFilters,
}: AlertsFiltersProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center flex-1">
        {/* Severity Filter */}
        <select
          value={severityFilter}
          onChange={(e) => onSeverityChange(e.target.value as AlertSeverity | 'all')}
          className="px-3 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        {/* Type Filter */}
        <select
          value={typeFilter}
          onChange={(e) => onTypeChange(e.target.value as AlertType | 'all')}
          className="px-3 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Types</option>
          <option value="performance">Performance</option>
          <option value="availability">Availability</option>
          <option value="security">Security</option>
          <option value="cost">Cost</option>
          <option value="capacity">Capacity</option>
        </select>

        {/* Status Filter */}
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value as AlertStatus | 'all')}
          className="px-3 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Status</option>
          <option value="unread">Unread</option>
          <option value="read">Read</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
          Clear Filters
        </button>
      )}
    </div>
  );
}
