import { useSearchParams } from 'react-router-dom';
import { DatabaseGrid } from '@/components/features/overview/DatabaseGrid';
import { useDatabases } from '@/hooks/useApi';
import { X, Loader2 } from 'lucide-react';

export function DatabasesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const cloudFilter = searchParams.get('cloud');
  const typeFilter = searchParams.get('type');

  // Fetch databases with filters from API
  const { data, isLoading, error } = useDatabases({
    cloud_provider: cloudFilter || undefined,
    database_type: typeFilter || undefined,
    page_size: 100,
  });

  const databases = data?.databases || [];

  const clearFilters = () => {
    setSearchParams({});
  };

  const removeCloudFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('cloud');
    setSearchParams(params);
  };

  const removeTypeFilter = () => {
    const params = new URLSearchParams(searchParams);
    params.delete('type');
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading databases...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
        <h2 className="text-lg font-semibold text-destructive">Error loading databases</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Unable to connect to the backend API. Make sure the server is running.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Error: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Databases</h1>
          <p className="text-muted-foreground mt-1">
            {databases.length} database{databases.length !== 1 ? 's' : ''} found
          </p>
        </div>
        {(cloudFilter || typeFilter) && (
          <button
            onClick={clearFilters}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Clear all filters
          </button>
        )}
      </div>

      {/* Active Filters */}
      {(cloudFilter || typeFilter) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">Active filters:</span>
          {cloudFilter && (
            <div className="flex items-center gap-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 px-3 py-1 rounded-full text-sm">
              <span>Cloud: {getCloudDisplayName(cloudFilter)}</span>
              <button
                onClick={removeCloudFilter}
                className="hover:bg-orange-200 dark:hover:bg-orange-800/50 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {typeFilter && (
            <div className="flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-3 py-1 rounded-full text-sm">
              <span>Type: {getTypeDisplayName(typeFilter)}</span>
              <button
                onClick={removeTypeFilter}
                className="hover:bg-blue-200 dark:hover:bg-blue-800/50 rounded-full p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Database Grid */}
      <DatabaseGrid databases={databases} />
    </div>
  );
}
