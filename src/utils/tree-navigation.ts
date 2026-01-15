import type { Database, CloudProvider } from '@/types';

export interface TreeNode {
  id: string;
  type: 'cloud' | 'region' | 'database';
  label: string;
  cloud?: CloudProvider;
  region?: string;
  database?: Database;
  children?: TreeNode[];
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
}

export interface SelectedNode {
  type: 'cloud' | 'region' | 'database';
  cloud?: CloudProvider;
  region?: string;
  database?: Database;
  databases: Database[];
}

/**
 * Builds tree structure from databases
 */
export function buildDatabaseTree(databases: Database[]): TreeNode[] {
  // Group by cloud
  const cloudMap = new Map<CloudProvider, Database[]>();
  databases.forEach((db) => {
    if (!cloudMap.has(db.cloud)) {
      cloudMap.set(db.cloud, []);
    }
    cloudMap.get(db.cloud)!.push(db);
  });

  // Build tree nodes
  const tree: TreeNode[] = [];

  cloudMap.forEach((cloudDbs, cloud) => {
    // Group by region within cloud
    const regionMap = new Map<string, Database[]>();
    cloudDbs.forEach((db) => {
      if (!regionMap.has(db.region)) {
        regionMap.set(db.region, []);
      }
      regionMap.get(db.region)!.push(db);
    });

    // Build region nodes
    const regionNodes: TreeNode[] = [];
    regionMap.forEach((regionDbs, region) => {
      // Sort databases by health status (critical first)
      const sortedDbs = [...regionDbs].sort((a, b) => {
        const statusOrder = { critical: 0, warning: 1, good: 2, excellent: 3, unknown: 4 };
        return statusOrder[a.healthStatus] - statusOrder[b.healthStatus];
      });

      // Build database nodes (show only first 5, rest collapsed)
      const databaseNodes: TreeNode[] = sortedDbs.slice(0, 5).map((db) => ({
        id: `db-${db.id}`,
        type: 'database',
        label: db.name,
        cloud,
        region,
        database: db,
        criticalCount: db.healthStatus === 'critical' ? 1 : 0,
        warningCount: db.healthStatus === 'warning' ? 1 : 0,
        healthyCount: db.healthStatus === 'excellent' || db.healthStatus === 'good' ? 1 : 0,
      }));

      regionNodes.push({
        id: `region-${cloud}-${region}`,
        type: 'region',
        label: region,
        cloud,
        region,
        children: databaseNodes,
        criticalCount: regionDbs.filter((db) => db.healthStatus === 'critical').length,
        warningCount: regionDbs.filter((db) => db.healthStatus === 'warning').length,
        healthyCount: regionDbs.filter(
          (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
        ).length,
      });
    });

    // Sort regions by problem severity
    regionNodes.sort((a, b) => {
      if (a.criticalCount !== b.criticalCount) return b.criticalCount - a.criticalCount;
      if (a.warningCount !== b.warningCount) return b.warningCount - a.warningCount;
      return a.label.localeCompare(b.label);
    });

    tree.push({
      id: `cloud-${cloud}`,
      type: 'cloud',
      label: cloud.toUpperCase(),
      cloud,
      children: regionNodes,
      criticalCount: cloudDbs.filter((db) => db.healthStatus === 'critical').length,
      warningCount: cloudDbs.filter((db) => db.healthStatus === 'warning').length,
      healthyCount: cloudDbs.filter(
        (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
      ).length,
    });
  });

  // Sort clouds alphabetically
  tree.sort((a, b) => a.label.localeCompare(b.label));

  return tree;
}

/**
 * Gets databases for a selected node
 */
export function getDatabasesForNode(node: TreeNode, allDatabases: Database[]): Database[] {
  if (node.type === 'database' && node.database) {
    return [node.database];
  }

  if (node.type === 'region' && node.cloud && node.region) {
    return allDatabases.filter((db) => db.cloud === node.cloud && db.region === node.region);
  }

  if (node.type === 'cloud' && node.cloud) {
    return allDatabases.filter((db) => db.cloud === node.cloud);
  }

  return [];
}

/**
 * Formats currency
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
