import type { Database, CloudProvider } from '@/types';

export interface RegionGroup {
  cloud: CloudProvider;
  region: string;
  databases: Database[];
  criticalCount: number;
  warningCount: number;
  healthyCount: number;
}

/**
 * Groups databases by cloud provider and region for heatmap display
 */
export function groupDatabasesByCloudAndRegion(databases: Database[]): Map<CloudProvider, Map<string, Database[]>> {
  const cloudMap = new Map<CloudProvider, Map<string, Database[]>>();

  databases.forEach((db) => {
    if (!cloudMap.has(db.cloud)) {
      cloudMap.set(db.cloud, new Map());
    }

    const regionMap = cloudMap.get(db.cloud)!;
    if (!regionMap.has(db.region)) {
      regionMap.set(db.region, []);
    }

    regionMap.get(db.region)!.push(db);
  });

  return cloudMap;
}

/**
 * Gets all unique regions across all databases, sorted by name
 */
export function getAllRegions(databases: Database[]): string[] {
  const regions = new Set<string>();
  databases.forEach((db) => regions.add(db.region));
  return Array.from(regions).sort();
}

/**
 * Creates region groups for heatmap cells
 */
export function createRegionGroups(databases: Database[]): RegionGroup[] {
  const groups: RegionGroup[] = [];
  const cloudMap = groupDatabasesByCloudAndRegion(databases);

  cloudMap.forEach((regionMap, cloud) => {
    regionMap.forEach((dbs, region) => {
      groups.push({
        cloud,
        region,
        databases: dbs,
        criticalCount: dbs.filter((db) => db.healthStatus === 'critical').length,
        warningCount: dbs.filter((db) => db.healthStatus === 'warning').length,
        healthyCount: dbs.filter(
          (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
        ).length,
      });
    });
  });

  return groups;
}

/**
 * Formats currency for display
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}
