import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { mockData } from '@/data/mock-data';
import { DatabaseGrid } from '@/components/features/overview/DatabaseGrid';
import { DatabaseFilters } from '@/components/features/databases/DatabaseFilters';
import type { Database, CloudProvider, DatabaseType, Environment, HealthStatus } from '@/types';

interface Filters {
  cloud?: CloudProvider;
  type?: DatabaseType;
  environment?: Environment;
  healthStatus?: HealthStatus;
  search?: string;
}

export function DatabasesPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>({});

  // Filter databases based on selected filters
  const filteredDatabases = useMemo(() => {
    let result = [...mockData.databases];

    // Search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      result = result.filter(db =>
        db.name.toLowerCase().includes(searchLower) ||
        db.id.toLowerCase().includes(searchLower)
      );
    }

    // Cloud filter
    if (filters.cloud) {
      result = result.filter(db => db.cloud === filters.cloud);
    }

    // Type filter
    if (filters.type) {
      result = result.filter(db => db.type === filters.type);
    }

    // Environment filter
    if (filters.environment) {
      result = result.filter(db => db.environment === filters.environment);
    }

    // Health status filter
    if (filters.healthStatus) {
      result = result.filter(db => db.healthStatus === filters.healthStatus);
    }

    return result;
  }, [filters]);

  // Calculate statistics
  const stats = useMemo(() => {
    const total = filteredDatabases.length;
    const healthy = filteredDatabases.filter(
      db => db.healthStatus === 'excellent' || db.healthStatus === 'good'
    ).length;
    const warning = filteredDatabases.filter(db => db.healthStatus === 'warning').length;
    const critical = filteredDatabases.filter(db => db.healthStatus === 'critical').length;

    return { total, healthy, warning, critical };
  }, [filteredDatabases]);

  const handleClearFilters = () => {
    setFilters({});
  };

  const handleDatabaseClick = (database: Database) => {
    // Navigate to database detail (we'll build this later)
    navigate(`/database/${database.id}`);
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">All Databases</h1>
        <p className="text-muted-foreground mt-2">
          Manage and monitor all your databases across clouds and regions
        </p>
      </div>

      {/* Stats Summary */}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Total Databases</div>
          <div className="text-2xl font-bold mt-2">{stats.total}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Healthy</div>
          <div className="text-2xl font-bold mt-2 text-green-500">{stats.healthy}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Warning</div>
          <div className="text-2xl font-bold mt-2 text-amber-500">{stats.warning}</div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="text-sm font-medium text-muted-foreground">Critical</div>
          <div className="text-2xl font-bold mt-2 text-red-500">{stats.critical}</div>
        </div>
      </div>

      {/* Filters */}
      <DatabaseFilters
        filters={filters}
        onFilterChange={setFilters}
        onClearFilters={handleClearFilters}
      />

      {/* Database Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">
            {filteredDatabases.length} {filteredDatabases.length === 1 ? 'Database' : 'Databases'}
          </h2>
        </div>

        {filteredDatabases.length > 0 ? (
          <DatabaseGrid databases={filteredDatabases} />
        ) : (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-lg font-medium">No databases found</p>
            <p className="text-sm text-muted-foreground mt-2">
              Try adjusting your filters to see more results
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
