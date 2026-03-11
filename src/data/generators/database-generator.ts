import type { Database, DatabaseType, CloudProvider, Environment, Trend, EnvironmentScoringConfigurations } from '@/types';
import { getHealthStatus } from '@/constants/health-thresholds';
import { computeHealthScore } from '@/lib/health-scoring';

const DATABASE_TYPES: DatabaseType[] = ['postgres', 'mysql', 'mongodb', 'redis', 'dynamodb', 'aurora', 'elasticsearch'];
const CLOUD_PROVIDERS: CloudProvider[] = ['aws', 'gcp', 'azure'];
const ENVIRONMENTS: Environment[] = ['production', 'staging', 'qa', 'development'];

const AWS_REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];
const GCP_REGIONS = ['us-central1', 'europe-west1', 'asia-east1'];
const AZURE_REGIONS = ['eastus', 'westeurope', 'southeastasia'];

const DB_NAME_PREFIXES = ['prod', 'stage', 'dev', 'test', 'demo'];
const DB_NAME_SUFFIXES = ['main', 'cache', 'analytics', 'replica', 'primary', 'backup'];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function weightedChoice<T>(array: T[], weights: number[]): T {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < array.length; i++) {
    random -= weights[i];
    if (random <= 0) {
      return array[i];
    }
  }

  return array[array.length - 1];
}

function generateTrend(healthScore: number): Trend {
  if (healthScore >= 90) {
    return weightedChoice<Trend>(['up', 'down', 'stable'], [0.2, 0.1, 0.7]);
  } else if (healthScore >= 70) {
    return weightedChoice<Trend>(['up', 'down', 'stable'], [0.3, 0.3, 0.4]);
  } else {
    return weightedChoice<Trend>(['up', 'down', 'stable'], [0.2, 0.5, 0.3]);
  }
}

/**
 * Generate metrics independently — broad ranges, not correlated to a pre-determined health score.
 */
function generateMetrics() {
  const maxConnections = randomChoice([100, 200, 500]);

  return {
    cpu: randomInt(15, 98),
    memory: randomInt(20, 98),
    storage: randomInt(25, 95),
    connections: randomInt(5, maxConnections),
    maxConnections,
    latency: randomInt(5, 500),
    throughput: randomInt(50, 2500),
  };
}

/**
 * Generate type-specific metrics for each database type.
 */
function generateTypeSpecificMetrics(dbType: DatabaseType): Record<string, number> {
  switch (dbType) {
    case 'postgres':
      // Replication lag in seconds: mostly low, sometimes high
      return { replicationLag: Math.random() < 0.8 ? randomInt(0, 5) : randomInt(5, 120) };
    case 'mysql':
      // Slow query ratio: percentage of slow queries
      return { slowQueryRatio: Math.random() < 0.7 ? randomInt(0, 5) : randomInt(5, 30) };
    case 'mongodb':
      // Lock contention: percentage of time waiting on locks
      return { lockContention: Math.random() < 0.75 ? randomInt(0, 10) : randomInt(10, 40) };
    case 'redis':
      // Eviction rate: evictions per second
      return { evictionRate: Math.random() < 0.7 ? randomInt(0, 50) : randomInt(50, 1000) };
    case 'dynamodb':
      // Throttled request percentage
      return { throttledRequests: Math.random() < 0.8 ? Math.round(Math.random() * 2 * 10) / 10 : randomInt(2, 20) };
    case 'aurora':
      // Buffer cache hit ratio (higher is better, typically 90-100%)
      return { bufferCacheHitRatio: Math.random() < 0.7 ? randomInt(95, 100) : randomInt(70, 95) };
    case 'elasticsearch':
      // Shard balance: how evenly shards are distributed (0-100%, 100=perfect)
      return { shardBalance: Math.random() < 0.6 ? randomInt(75, 100) : randomInt(30, 75) };
  }
}

function generateIssueCount(healthScore: number): number {
  if (healthScore < 70) {
    return randomInt(3, 8);
  } else if (healthScore < 85) {
    return randomInt(1, 3);
  } else if (healthScore < 95) {
    return Math.random() > 0.5 ? 1 : 0;
  }
  return 0;
}

function generateCost(dbType: DatabaseType, cloud: CloudProvider, environment: Environment): number {
  let baseCost = 100;

  const typeMultiplier: Record<DatabaseType, number> = {
    postgres: 1.2,
    mysql: 1.0,
    mongodb: 1.3,
    redis: 0.8,
    dynamodb: 0.9,
    aurora: 1.5,
    elasticsearch: 1.4,
  };

  const cloudMultiplier: Record<CloudProvider, number> = {
    aws: 1.0,
    gcp: 0.95,
    azure: 1.05,
  };

  const envMultiplier: Record<Environment, number> = {
    production: 3.0,
    staging: 1.5,
    qa: 1.0,
    development: 0.5,
  };

  const cost = baseCost * typeMultiplier[dbType] * cloudMultiplier[cloud] * envMultiplier[environment];
  const variation = cost * (Math.random() * 0.4 - 0.2);

  return Math.round((cost + variation) * 100) / 100;
}

function generateRegion(cloud: CloudProvider): string {
  switch (cloud) {
    case 'aws':
      return randomChoice(AWS_REGIONS);
    case 'gcp':
      return randomChoice(GCP_REGIONS);
    case 'azure':
      return randomChoice(AZURE_REGIONS);
  }
}

function generateDatabaseName(): string {
  const prefix = randomChoice(DB_NAME_PREFIXES);
  const suffix = randomChoice(DB_NAME_SUFFIXES);
  const number = Math.random() > 0.5 ? `-${randomInt(1, 5)}` : '';
  return `${prefix}-${suffix}${number}`;
}

function generateTags(environment: Environment, dbType: DatabaseType): Record<string, string> {
  return {
    environment,
    type: dbType,
    team: randomChoice(['platform', 'data', 'backend', 'analytics']),
    managed_by: 'terraform',
  };
}

function generatePastDate(daysAgo: number): Date {
  const now = new Date();
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

function generateRecentTimestamp(minutesAgo: number = 5): Date {
  const now = new Date();
  return new Date(now.getTime() - minutesAgo * 60 * 1000);
}

export function generateDatabases(count: number = 50, scoringConfigs?: EnvironmentScoringConfigurations): Database[] {
  const databases: Database[] = [];

  for (let i = 0; i < count; i++) {
    const cloud = randomChoice(CLOUD_PROVIDERS);
    const dbType = randomChoice(DATABASE_TYPES);
    const environment = weightedChoice(ENVIRONMENTS, [0.35, 0.25, 0.15, 0.25]);
    const metrics = generateMetrics();
    const typeSpecificMetrics = generateTypeSpecificMetrics(dbType);

    // ~5% chance of unknown health
    const isUnknown = Math.random() < 0.05;

    let healthScore: number;
    let healthStatus: Database['healthStatus'];

    if (isUnknown) {
      healthScore = -1;
      healthStatus = 'unknown';
    } else if (scoringConfigs) {
      const envConfig = scoringConfigs[environment];
      const breakdown = computeHealthScore(metrics, dbType, envConfig, typeSpecificMetrics);
      healthScore = breakdown.overallScore;
      healthStatus = getHealthStatus(healthScore);
    } else {
      // Fallback: simple average if no config provided
      healthScore = 75;
      healthStatus = getHealthStatus(healthScore);
    }

    databases.push({
      id: `db-${Math.random().toString(16).slice(2, 8)}`,
      name: generateDatabaseName(),
      type: dbType,
      cloud,
      region: generateRegion(cloud),
      environment,
      healthScore,
      healthStatus,
      healthTrend: generateTrend(healthScore),
      metrics,
      typeSpecificMetrics,
      activeIssues: generateIssueCount(healthScore),
      recentChanges: randomInt(0, 5),
      monthlyCost: generateCost(dbType, cloud, environment),
      costTrend: randomChoice<Trend>(['up', 'down', 'stable']),
      createdAt: generatePastDate(randomInt(30, 365)),
      lastChecked: generateRecentTimestamp(randomInt(1, 5)),
      tags: generateTags(environment, dbType),
    });
  }

  return databases;
}
