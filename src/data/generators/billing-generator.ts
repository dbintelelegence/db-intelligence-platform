import type { Database, DatabaseCost, CostAnomaly, CostTimeSeries, CostBreakdown, CloudProvider, DatabaseType, Trend } from '@/types';
import { subDays } from 'date-fns';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generateCostBreakdown(totalCost: number): CostBreakdown {
  // Distribute cost across components
  const compute = totalCost * (0.4 + Math.random() * 0.2); // 40-60%
  const storage = totalCost * (0.2 + Math.random() * 0.15); // 20-35%
  const backup = totalCost * (0.05 + Math.random() * 0.05); // 5-10%
  const dataTransfer = totalCost * (0.05 + Math.random() * 0.1); // 5-15%
  const other = totalCost - compute - storage - backup - dataTransfer;

  return {
    compute: Math.round(compute * 100) / 100,
    storage: Math.round(storage * 100) / 100,
    backup: Math.round(backup * 100) / 100,
    dataTransfer: Math.round(dataTransfer * 100) / 100,
    other: Math.round(Math.max(0, other) * 100) / 100,
  };
}

function generateCostTrend(): { change: number; direction: Trend } {
  const change = Math.round((Math.random() * 40 - 10) * 10) / 10; // -10% to +30%
  const direction: Trend = change > 5 ? 'up' : change < -5 ? 'down' : 'stable';

  return { change, direction };
}

function generateForecast(currentCost: number, trend: { change: number }) {
  const trendFactor = 1 + (trend.change / 100);
  const variability = 0.9 + Math.random() * 0.2; // ±10% variability
  const nextMonth = currentCost * trendFactor * variability;
  const confidence = randomInt(75, 95);

  return {
    nextMonth: Math.round(nextMonth * 100) / 100,
    confidence,
  };
}

export function generateDatabaseCosts(databases: Database[]): DatabaseCost[] {
  return databases.map(db => {
    const trend = generateCostTrend();

    return {
      databaseId: db.id,
      databaseName: db.name,
      totalCost: db.monthlyCost,
      breakdown: generateCostBreakdown(db.monthlyCost),
      trend,
      forecast: generateForecast(db.monthlyCost, trend),
    };
  });
}

export function generateCostAnomalies(databases: Database[], costs: DatabaseCost[]): CostAnomaly[] {
  const anomalies: CostAnomaly[] = [];

  // Generate 3-5 cost anomalies from databases with significant cost increases
  const candidateDatabases = databases
    .map((db, index) => ({ db, cost: costs[index] }))
    .filter(({ cost }) => cost.trend.change > 20 || cost.totalCost > 500)
    .slice(0, 5);

  candidateDatabases.forEach(({ db, cost }, index) => {
    const type = randomChoice<'spike' | 'sustained_increase' | 'unexpected_charge'>([
      'spike',
      'sustained_increase',
      'unexpected_charge',
    ]);

    const explanations = {
      spike: `Sudden cost spike detected on ${new Date(Date.now() - randomInt(1, 7) * 24 * 60 * 60 * 1000).toLocaleDateString()}. Analysis shows ${randomInt(200, 500)}% increase in data transfer costs, likely caused by increased query volume or a data export operation.`,
      sustained_increase: `Cost has been steadily increasing over the past ${randomInt(7, 14)} days. Primary driver is ${randomChoice(['compute', 'storage', 'IOPS'])} usage growing at ${randomInt(15, 30)}% week-over-week.`,
      unexpected_charge: `Unexpected charges detected for ${randomChoice(['backup storage', 'data transfer', 'compute hours'])}. This may be due to misconfigured retention policies or unoptimized queries.`,
    };

    const possibleCauses = {
      spike: [
        'Large data export or backup operation',
        'Traffic spike from new feature launch',
        'Inefficient query causing excessive reads',
        'Automated batch job running during peak hours',
      ],
      sustained_increase: [
        'Growing dataset without storage optimization',
        'Increasing user base and query volume',
        'Data retention policy not being applied',
        'Lack of query result caching',
      ],
      unexpected_charge: [
        'Backup retention period too long',
        'Cross-region data transfer',
        'Snapshot costs accumulating',
        'Development databases not shut down',
      ],
    };

    const baseline = cost.totalCost / (1 + cost.trend.change / 100);

    anomalies.push({
      id: `anomaly-${db.id}-${index}`,
      databaseId: db.id,
      databaseName: db.name,
      detectedAt: new Date(Date.now() - randomInt(1, 10) * 24 * 60 * 60 * 1000),
      type,
      amount: cost.totalCost,
      baseline: Math.round(baseline * 100) / 100,
      explanation: explanations[type],
      possibleCauses: possibleCauses[type].slice(0, 3),
    });
  });

  return anomalies;
}

export function generateCostTimeSeries(databases: Database[], days: number = 30): CostTimeSeries[] {
  const series: CostTimeSeries[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = subDays(new Date(), i);

    // Calculate total and breakdowns
    let total = 0;
    const byCloud: Record<CloudProvider, number> = { aws: 0, gcp: 0, azure: 0 };
    const byType: Record<DatabaseType, number> = {
      postgres: 0,
      mysql: 0,
      mongodb: 0,
      redis: 0,
      dynamodb: 0,
      aurora: 0,
      elasticsearch: 0,
    };
    const byRegion: Record<string, number> = {};

    databases.forEach(db => {
      // Add some daily variation (±10%)
      const dailyVariation = 0.9 + Math.random() * 0.2;
      const dailyCost = (db.monthlyCost / 30) * dailyVariation;

      total += dailyCost;
      byCloud[db.cloud] += dailyCost;
      byType[db.type] += dailyCost;

      if (!byRegion[db.region]) {
        byRegion[db.region] = 0;
      }
      byRegion[db.region] += dailyCost;
    });

    series.push({
      date,
      total: Math.round(total * 100) / 100,
      byCloud: {
        aws: Math.round(byCloud.aws * 100) / 100,
        gcp: Math.round(byCloud.gcp * 100) / 100,
        azure: Math.round(byCloud.azure * 100) / 100,
      },
      byType: Object.fromEntries(
        Object.entries(byType).map(([key, value]) => [key, Math.round(value * 100) / 100])
      ) as Record<DatabaseType, number>,
      byRegion: Object.fromEntries(
        Object.entries(byRegion).map(([key, value]) => [key, Math.round(value * 100) / 100])
      ),
    });
  }

  return series;
}
