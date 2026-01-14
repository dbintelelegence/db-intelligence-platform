import { ExecutiveSummary } from '@/components/features/overview/ExecutiveSummary';
import { DatabaseGrid } from '@/components/features/overview/DatabaseGrid';
import { useOverviewData } from '@/hooks/useApi';
import { Loader2 } from 'lucide-react';

export function OverviewPage() {
  const { databases, summary, isLoading, error } = useOverviewData();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
        <h2 className="text-lg font-semibold text-destructive">Error loading data</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Unable to connect to the backend API. Make sure the server is running at{' '}
          <code className="bg-muted px-1 rounded">http://localhost:8000</code>
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Error: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Database Overview</h1>
        <p className="text-muted-foreground mt-2">
          Complete view of your database fleet health, performance, and costs
        </p>
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary {...summary} />

      {/* Database Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">All Databases ({summary.totalDatabases})</h2>
        </div>
        <DatabaseGrid databases={databases} />
      </div>
    </div>
  );
}
