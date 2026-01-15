import { useMemo, useState } from 'react';
import { mockData } from '@/data/mock-data';
import { ExecutiveSummary } from '@/components/features/overview/ExecutiveSummary';
import { GlobalMapView } from '@/components/features/overview/GlobalMapView';
import { MapRegionDetails } from '@/components/features/overview/MapRegionDetails';
import type { RegionMarker } from '@/utils/map-coordinates';

export function OverviewPage() {
  const [selectedMarker, setSelectedMarker] = useState<RegionMarker | null>(
    null
  );

  // Calculate summary statistics
  const summary = useMemo(() => {
    const totalDatabases = mockData.databases.length;
    const healthyDatabases = mockData.databases.filter(
      (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
    ).length;
    const warningDatabases = mockData.databases.filter(
      (db) => db.healthStatus === 'warning'
    ).length;
    const criticalDatabases = mockData.databases.filter(
      (db) => db.healthStatus === 'critical'
    ).length;
    const totalCost = mockData.databases.reduce(
      (sum, db) => sum + db.monthlyCost,
      0
    );
    const activeIssues = mockData.issues.filter(
      (issue) => issue.status === 'active'
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
    <div className="space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Database Overview</h1>
        <p className="text-muted-foreground mt-1">
          Geographic view of your database fleet health and distribution
        </p>
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary {...summary} />

      {/* Global Map */}
      <GlobalMapView
        databases={mockData.databases}
        selectedMarker={selectedMarker}
        onMarkerSelect={setSelectedMarker}
      />

      {/* Region Details */}
      <MapRegionDetails marker={selectedMarker} />
    </div>
  );
}
