import { useMemo, useState } from 'react';
import { mockData } from '@/data/mock-data';
import { ExecutiveSummary } from '@/components/features/overview/ExecutiveSummary';
import { FleetHeatmap } from '@/components/features/overview/FleetHeatmap';
import { ProblemSummaryPanel } from '@/components/features/overview/ProblemSummaryPanel';
import type { RegionGroup } from '@/utils/aggregation';

export function OverviewPage() {
  const [selectedRegion, setSelectedRegion] = useState<RegionGroup | null>(null);

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
          Visual health map of your database fleet by cloud and region
        </p>
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary {...summary} />

      {/* Fleet Heatmap */}
      <FleetHeatmap
        databases={mockData.databases}
        onRegionSelect={setSelectedRegion}
        selectedGroup={selectedRegion}
      />

      {/* Problem Summary Panel */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          {selectedRegion ? 'Region Details' : 'Select a Region'}
        </h2>
        <ProblemSummaryPanel group={selectedRegion} />
      </div>
    </div>
  );
}
