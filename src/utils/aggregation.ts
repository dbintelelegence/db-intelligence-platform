import type { Database, CloudProvider, Trend } from '@/types';

export interface CloudAggregate {
  cloud: CloudProvider;
  databaseCount: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  monthlyCost: number;
  costTrend: Trend;
  avgHealthScore: number;
  regions: RegionAggregate[];
}

export interface RegionAggregate {
  region: string;
  cloud: CloudProvider;
  databaseCount: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  monthlyCost: number;
  avgHealthScore: number;
  databases: Database[];
  topIssues: string[];
}

/**
 * Aggregates databases by cloud provider and region
 */
export function aggregateDatabasesByCloud(databases: Database[]): CloudAggregate[] {
  // Group databases by cloud provider
  const cloudMap = new Map<CloudProvider, Database[]>();

  databases.forEach((db) => {
    if (!cloudMap.has(db.cloud)) {
      cloudMap.set(db.cloud, []);
    }
    cloudMap.get(db.cloud)!.push(db);
  });

  // Create cloud aggregates
  const cloudAggregates: CloudAggregate[] = [];

  cloudMap.forEach((dbs, cloud) => {
    const regions = aggregateByRegion(dbs, cloud);

    const aggregate: CloudAggregate = {
      cloud,
      databaseCount: dbs.length,
      healthyCount: dbs.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good').length,
      warningCount: dbs.filter(db => db.healthStatus === 'warning').length,
      criticalCount: dbs.filter(db => db.healthStatus === 'critical').length,
      monthlyCost: dbs.reduce((sum, db) => sum + db.monthlyCost, 0),
      costTrend: calculateTrend(dbs.map(db => db.costTrend)),
      avgHealthScore: dbs.reduce((sum, db) => sum + db.healthScore, 0) / dbs.length,
      regions,
    };

    cloudAggregates.push(aggregate);
  });

  // Sort by cloud name
  cloudAggregates.sort((a, b) => a.cloud.localeCompare(b.cloud));

  return cloudAggregates;
}

/**
 * Aggregates databases by region within a cloud
 */
function aggregateByRegion(databases: Database[], cloud: CloudProvider): RegionAggregate[] {
  // Group databases by region
  const regionMap = new Map<string, Database[]>();

  databases.forEach((db) => {
    if (!regionMap.has(db.region)) {
      regionMap.set(db.region, []);
    }
    regionMap.get(db.region)!.push(db);
  });

  // Create region aggregates
  const regionAggregates: RegionAggregate[] = [];

  regionMap.forEach((dbs, region) => {
    const aggregate: RegionAggregate = {
      region,
      cloud,
      databaseCount: dbs.length,
      healthyCount: dbs.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good').length,
      warningCount: dbs.filter(db => db.healthStatus === 'warning').length,
      criticalCount: dbs.filter(db => db.healthStatus === 'critical').length,
      monthlyCost: dbs.reduce((sum, db) => sum + db.monthlyCost, 0),
      avgHealthScore: dbs.reduce((sum, db) => sum + db.healthScore, 0) / dbs.length,
      databases: dbs,
      topIssues: generateProblemSummary(dbs),
    };

    regionAggregates.push(aggregate);
  });

  // Sort regions by problem severity (critical first, then warning, then healthy)
  regionAggregates.sort((a, b) => {
    if (a.criticalCount !== b.criticalCount) {
      return b.criticalCount - a.criticalCount;
    }
    if (a.warningCount !== b.warningCount) {
      return b.warningCount - a.warningCount;
    }
    return a.region.localeCompare(b.region);
  });

  return regionAggregates;
}

/**
 * Generates human-readable problem summaries for a group of databases
 */
export function generateProblemSummary(databases: Database[]): string[] {
  const issues: string[] = [];

  // Check for high CPU
  const highCpuDbs = databases.filter(db => db.metrics.cpu >= 85);
  if (highCpuDbs.length > 0) {
    issues.push(`${highCpuDbs.length} database${highCpuDbs.length > 1 ? 's have' : ' has'} high CPU (>85%)`);
  }

  // Check for high memory
  const highMemoryDbs = databases.filter(db => db.metrics.memory >= 85);
  if (highMemoryDbs.length > 0) {
    issues.push(`${highMemoryDbs.length} database${highMemoryDbs.length > 1 ? 's have' : ' has'} high memory (>85%)`);
  }

  // Check for high storage
  const highStorageDbs = databases.filter(db => db.metrics.storage >= 85);
  if (highStorageDbs.length > 0) {
    issues.push(`${highStorageDbs.length} database${highStorageDbs.length > 1 ? 's have' : ' has'} high storage (>85%)`);
  }

  // Check for connection issues
  const highConnectionDbs = databases.filter(
    db => db.metrics.connections >= db.metrics.maxConnections * 0.9
  );
  if (highConnectionDbs.length > 0) {
    issues.push(`${highConnectionDbs.length} database${highConnectionDbs.length > 1 ? 's are' : ' is'} near connection limit`);
  }

  // Check for high latency
  const highLatencyDbs = databases.filter(db => db.metrics.latency >= 100);
  if (highLatencyDbs.length > 0) {
    issues.push(`${highLatencyDbs.length} database${highLatencyDbs.length > 1 ? 's have' : ' has'} high latency (>100ms)`);
  }

  // Check for active issues
  const totalIssues = databases.reduce((sum, db) => sum + db.activeIssues, 0);
  if (totalIssues > 0 && issues.length === 0) {
    issues.push(`${totalIssues} active issue${totalIssues > 1 ? 's' : ''} detected`);
  }

  return issues;
}

/**
 * Calculates the dominant trend from multiple trends
 */
function calculateTrend(trends: Trend[]): Trend {
  const trendCounts = {
    up: trends.filter(t => t === 'up').length,
    down: trends.filter(t => t === 'down').length,
    stable: trends.filter(t => t === 'stable').length,
  };

  if (trendCounts.up > trendCounts.down && trendCounts.up > trendCounts.stable) {
    return 'up';
  } else if (trendCounts.down > trendCounts.up && trendCounts.down > trendCounts.stable) {
    return 'down';
  }
  return 'stable';
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

/**
 * Gets health color class based on score
 */
export function getHealthColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  return 'bg-red-500';
}

/**
 * Gets cloud-specific border color
 */
export function getCloudBorderColor(cloud: CloudProvider): string {
  const colors = {
    aws: 'border-orange-500',
    gcp: 'border-blue-500',
    azure: 'border-sky-500',
  };
  return colors[cloud] || 'border-gray-500';
}
