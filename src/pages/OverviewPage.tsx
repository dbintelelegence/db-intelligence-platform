import { useMemo } from 'react';
import { mockData } from '@/data/mock-data';
import { ExecutiveSummary } from '@/components/features/overview/ExecutiveSummary';
import { DatabaseGrid } from '@/components/features/overview/DatabaseGrid';

export function OverviewPage() {
  // Calculate summary statistics
  const summary = useMemo(() => {
    const totalDatabases = mockData.databases.length;
    const healthyDatabases = mockData.databases.filter(
      db => db.healthStatus === 'excellent' || db.healthStatus === 'good'
    ).length;
    const warningDatabases = mockData.databases.filter(
      db => db.healthStatus === 'warning'
    ).length;
    const criticalDatabases = mockData.databases.filter(
      db => db.healthStatus === 'critical'
    ).length;
    const totalCost = mockData.databases.reduce(
      (sum, db) => sum + db.monthlyCost,
      0
    );
    const activeIssues = mockData.issues.filter(
      issue => issue.status === 'active'
    ).length;

    return {
      totalDatabases,
      healthyDatabases,
      warningDatabases,
      criticalDatabases,
      totalCost,
      activeIssues,
    };
  }, []);

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
        <DatabaseGrid databases={mockData.databases} />
      </div>
    </div>
  );
}
