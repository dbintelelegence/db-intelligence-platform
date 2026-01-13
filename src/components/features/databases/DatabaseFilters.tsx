import { Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CloudProvider, DatabaseType, Environment, HealthStatus } from '@/types';

interface DatabaseFiltersProps {
  filters: {
    cloud?: CloudProvider;
    type?: DatabaseType;
    environment?: Environment;
    healthStatus?: HealthStatus;
    search?: string;
  };
  onFilterChange: (filters: any) => void;
  onClearFilters: () => void;
}

export function DatabaseFilters({ filters, onFilterChange, onClearFilters }: DatabaseFiltersProps) {
  const hasActiveFilters = Object.values(filters).some(v => v && v !== '');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Filters</h3>
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-muted-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Clear All
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {/* Search */}
        <div>
          <label className="text-sm font-medium mb-2 block">Search</label>
          <input
            type="text"
            placeholder="Database name..."
            value={filters.search || ''}
            onChange={(e) => onFilterChange({ ...filters, search: e.target.value })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        {/* Cloud Provider */}
        <div>
          <label className="text-sm font-medium mb-2 block">Cloud Provider</label>
          <select
            value={filters.cloud || ''}
            onChange={(e) => onFilterChange({ ...filters, cloud: e.target.value || undefined })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All Clouds</option>
            <option value="aws">AWS</option>
            <option value="gcp">GCP</option>
            <option value="azure">Azure</option>
          </select>
        </div>

        {/* Database Type */}
        <div>
          <label className="text-sm font-medium mb-2 block">Database Type</label>
          <select
            value={filters.type || ''}
            onChange={(e) => onFilterChange({ ...filters, type: e.target.value || undefined })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All Types</option>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
            <option value="mongodb">MongoDB</option>
            <option value="redis">Redis</option>
            <option value="dynamodb">DynamoDB</option>
            <option value="aurora">Aurora</option>
          </select>
        </div>

        {/* Environment */}
        <div>
          <label className="text-sm font-medium mb-2 block">Environment</label>
          <select
            value={filters.environment || ''}
            onChange={(e) => onFilterChange({ ...filters, environment: e.target.value || undefined })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All Environments</option>
            <option value="production">Production</option>
            <option value="staging">Staging</option>
            <option value="development">Development</option>
          </select>
        </div>

        {/* Health Status */}
        <div>
          <label className="text-sm font-medium mb-2 block">Health Status</label>
          <select
            value={filters.healthStatus || ''}
            onChange={(e) => onFilterChange({ ...filters, healthStatus: e.target.value || undefined })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All Statuses</option>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </div>
    </div>
  );
}
