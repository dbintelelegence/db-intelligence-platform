import type { Database, DatabaseType, CloudProvider, Environment, Trend } from '@/types';
import { getHealthStatus } from '@/constants/health-thresholds';

const DATABASE_TYPES: DatabaseType[] = ['postgres', 'mysql', 'mongodb', 'redis', 'dynamodb', 'aurora'];
const CLOUD_PROVIDERS: CloudProvider[] = ['aws', 'gcp', 'azure'];
const ENVIRONMENTS: Environment[] = ['production', 'staging', 'development'];

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

function generateHealthScore(): number {
  const random = Math.random();

  // 60% healthy (85-100)
  if (random < 0.6) {
    return randomInt(85, 100);
  }
  // 25% warning (70-84)
  else if (random < 0.85) {
    return randomInt(70, 84);
  }
  // 10% critical (40-69)
  else if (random < 0.95) {
    return randomInt(40, 69);
  }
  // 5% unknown
  else {
    return -1;
  }
}

function generateTrend(healthScore: number): Trend {
  if (healthScore >= 90) {
    // Healthy databases are more likely to be stable or improving
    return weightedChoice<Trend>(['up', 'down', 'stable'], [0.2, 0.1, 0.7]);
  } else if (healthScore >= 70) {
    // Warning databases have mixed trends
    return weightedChoice<Trend>(['up', 'down', 'stable'], [0.3, 0.3, 0.4]);
  } else {
    // Critical databases are more likely to be declining
    return weightedChoice<Trend>(['up', 'down', 'stable'], [0.2, 0.5, 0.3]);
  }
}

function generateMetrics(healthScore: number) {
  // Base metrics on health score
  const isCritical = healthScore < 70;
  const isWarning = healthScore >= 70 && healthScore < 85;

  return {
    cpu: isCritical ? randomInt(80, 98) : isWarning ? randomInt(60, 79) : randomInt(20, 59),
    memory: isCritical ? randomInt(85, 98) : isWarning ? randomInt(65, 84) : randomInt(30, 64),
    storage: isCritical ? randomInt(80, 95) : isWarning ? randomInt(65, 79) : randomInt(40, 64),
    connections: isCritical ? randomInt(90, 100) : isWarning ? randomInt(60, 89) : randomInt(20, 59),
    maxConnections: 100,
    latency: isCritical ? randomInt(100, 500) : isWarning ? randomInt(50, 99) : randomInt(10, 49),
    throughput: isCritical ? randomInt(50, 200) : isWarning ? randomInt(200, 500) : randomInt(500, 2000),
  };
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

  // Type multiplier
  const typeMultiplier: Record<DatabaseType, number> = {
    postgres: 1.2,
    mysql: 1.0,
    mongodb: 1.3,
    redis: 0.8,
    dynamodb: 0.9,
    aurora: 1.5,
  };

  // Cloud multiplier
  const cloudMultiplier: Record<CloudProvider, number> = {
    aws: 1.0,
    gcp: 0.95,
    azure: 1.05,
  };

  // Environment multiplier
  const envMultiplier: Record<Environment, number> = {
    production: 3.0,
    staging: 1.5,
    development: 0.5,
  };

  const cost = baseCost * typeMultiplier[dbType] * cloudMultiplier[cloud] * envMultiplier[environment];
  const variation = cost * (Math.random() * 0.4 - 0.2); // ±20% variation

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

export function generateDatabases(count: number = 50): Database[] {
  const databases: Database[] = [];

  for (let i = 0; i < count; i++) {
    const cloud = randomChoice(CLOUD_PROVIDERS);
    const dbType = randomChoice(DATABASE_TYPES);
    const environment = weightedChoice(ENVIRONMENTS, [0.4, 0.3, 0.3]); // More prod databases
    const healthScore = generateHealthScore();
    const healthStatus = healthScore >= 0 ? getHealthStatus(healthScore) : 'unknown';

    databases.push({
      id: `db-${i + 1}`,
      name: generateDatabaseName(),
      type: dbType,
      cloud,
      region: generateRegion(cloud),
      environment,
      healthScore,
      healthStatus,
      healthTrend: generateTrend(healthScore),
      metrics: generateMetrics(healthScore),
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
