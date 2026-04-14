import { useSearchParams } from 'react-router-dom';
import { DatabaseGrid } from '@/components/features/overview/DatabaseGrid';
import { X } from 'lucide-react';
import { useDashboard } from '@/hooks/useDashboard';

export function DatabasesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { clusters } = useDashboard();

  const cloudFilter  = searchParams.get('cloud');
  const typeFilter   = searchParams.get('type');
  const statusFilter = searchParams.get('status'); // 'healthy' | 'attention'

  let filteredDatabases = clusters;

  if (statusFilter === 'healthy') {
    filteredDatabases = filteredDatabases.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good');
  } else if (statusFilter === 'attention') {
    filteredDatabases = filteredDatabases.filter(db => db.healthStatus === 'warning' || db.healthStatus === 'critical');
  }

  if (cloudFilter) {
    filteredDatabases = filteredDatabases.filter(db => db.cloud === cloudFilter);
  }

  if (typeFilter) {
    filteredDatabases = filteredDatabases.filter(db => db.type === typeFilter);
  }

  const clearFilters = () => setSearchParams({});

  const removeFilter = (key: string) => {
    const params = new URLSearchParams(searchParams);
    params.delete(key);
    setSearchParams(params);
  };

  const getCloudDisplayName = (cloud: string) => {
    return cloud.toUpperCase();
  };

  const getTypeDisplayName = (type: string) => {
    const names: Record<string, string> = {
      postgres: 'PostgreSQL',
      mysql: 'MySQL',
      mongodb: 'MongoDB',
      redis: 'Redis',
      dynamodb: 'DynamoDB',
      aurora: 'Aurora',
    };
    return names[type] || type;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Databases</h1>
          <p className="text-muted-foreground mt-1">
            {filteredDatabases.length} database{filteredDatabases.length !== 1 ? 's' : ''} found
          </p>
        </div>
        {(cloudFilter || typeFilter || statusFilter) && (
          <button onClick={clearFilters} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Clear all filters
          </button>
        )}
      </div>

      {/* Active Filters */}
      {(cloudFilter || typeFilter || statusFilter) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {statusFilter && (
            <div className="flex items-center gap-1 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300 px-3 py-1 rounded-full text-sm">
              <span>{statusFilter === 'healthy' ? 'Healthy' : 'Needs attention'}</span>
              <button onClick={() => removeFilter('status')} className="hover:bg-emerald-200 dark:hover:bg-emerald-800/50 rounded-full p-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {cloudFilter && (
            <div className="flex items-center gap-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 px-3 py-1 rounded-full text-sm">
              <span>Cloud: {getCloudDisplayName(cloudFilter)}</span>
              <button onClick={() => removeFilter('cloud')} className="hover:bg-orange-200 dark:hover:bg-orange-800/50 rounded-full p-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {typeFilter && (
            <div className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm">
              <span>Type: {getTypeDisplayName(typeFilter)}</span>
              <button onClick={() => removeFilter('type')} className="hover:bg-blue-200 dark:hover:bg-blue-800/50 rounded-full p-0.5">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Database Grid */}
      <DatabaseGrid databases={filteredDatabases} />
    </div>
  );
}
