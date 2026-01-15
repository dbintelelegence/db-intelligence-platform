import { useMemo, useState } from 'react';
import { mockData } from '@/data/mock-data';
import { ExecutiveSummary } from '@/components/features/overview/ExecutiveSummary';
import { FleetTreeNavigator } from '@/components/features/overview/FleetTreeNavigator';
import { RegionDetailPanel } from '@/components/features/overview/RegionDetailPanel';
import { buildDatabaseTree, getDatabasesForNode, type TreeNode } from '@/utils/tree-navigation';

export function OverviewPage() {
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);

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

  // Build tree structure
  const tree = useMemo(() => buildDatabaseTree(mockData.databases), []);

  // Get databases for selected node
  const selectedDatabases = useMemo(() => {
    if (!selectedNode) return [];
    return getDatabasesForNode(selectedNode, mockData.databases);
  }, [selectedNode]);

  return (
    <div className="space-y-8">
      {/* Page Title */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Database Overview</h1>
        <p className="text-muted-foreground mt-2">
          Navigate your database fleet with hierarchical tree view
        </p>
      </div>

      {/* Executive Summary */}
      <ExecutiveSummary {...summary} />

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-6">
        {/* Left sidebar - Tree Navigator */}
        <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-200px)]">
          <FleetTreeNavigator
            tree={tree}
            selectedNode={selectedNode}
            onNodeSelect={setSelectedNode}
          />
        </div>

        {/* Right panel - Details */}
        <div>
          <RegionDetailPanel selectedNode={selectedNode} databases={selectedDatabases} />
        </div>
      </div>
    </div>
  );
}
