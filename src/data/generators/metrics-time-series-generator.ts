import { subMinutes } from 'date-fns';
import type { Database } from '@/types';
import type { TimeRange } from '@/hooks/useTimeRange';

export interface MetricDataPoint {
  timestamp: Date;
  value: number;
}

export interface DatabaseMetricsTimeSeries {
  cpu: MetricDataPoint[];
  memory: MetricDataPoint[];
  storage: MetricDataPoint[];
  connections: MetricDataPoint[];
  latency: MetricDataPoint[];
  throughput: MetricDataPoint[];
}

function getDataPointCount(timeRange: TimeRange): number {
  const { value } = timeRange;
  switch (value) {
    case '1h': return 12; // Every 5 minutes
    case '24h': return 48; // Every 30 minutes
    case '7d': return 168; // Every hour
    case '30d': return 360; // Every 2 hours
    default: return 48;
  }
}

function getTimeIncrement(timeRange: TimeRange): number {
  const { value } = timeRange;
  switch (value) {
    case '1h': return 5; // 5 minutes
    case '24h': return 30; // 30 minutes
    case '7d': return 60; // 1 hour
    case '30d': return 120; // 2 hours
    default: return 30;
  }
}

function generateDataPoints(
  currentValue: number,
  dataPointCount: number,
  timeRange: TimeRange,
  options: {
    min?: number;
    max?: number;
    variationPercent?: number;
    onlyIncrease?: boolean;
    correlateWith?: MetricDataPoint[];
    correlationFactor?: number;
  } = {}
): MetricDataPoint[] {
  const {
    min = 0,
    max = 100,
    variationPercent = 15,
    onlyIncrease = false,
    correlateWith,
    correlationFactor = 0.3,
  } = options;

  const points: MetricDataPoint[] = [];
  const timeIncrement = getTimeIncrement(timeRange);
  const end = timeRange.end;

  // Start from current value and work backwards
  let value = currentValue;

  for (let i = 0; i < dataPointCount; i++) {
    // Calculate timestamp (going backwards from end)
    const minutesAgo = i * timeIncrement;
    const timestamp = subMinutes(end, minutesAgo);

    // Add variation
    let variation = (Math.random() - 0.5) * 2 * (variationPercent / 100);

    // If correlated with another metric, adjust variation
    if (correlateWith && correlateWith[i]) {
      const correlatedChange = i > 0
        ? (correlateWith[i].value - correlateWith[i - 1].value) / correlateWith[i - 1].value
        : 0;
      variation += correlatedChange * correlationFactor;
    }

    // Apply variation
    if (onlyIncrease) {
      value = value - Math.abs(variation * value);
    } else {
      value = value - variation * value;
    }

    // Clamp to min/max
    value = Math.max(min, Math.min(max, value));

    // Add some randomness for realism
    const noise = (Math.random() - 0.5) * 2;
    value = value + noise;
    value = Math.max(min, Math.min(max, value));

    points.push({
      timestamp,
      value: Math.round(value * 100) / 100,
    });
  }

  // Reverse to get chronological order
  return points.reverse();
}

export function generateMetricsTimeSeries(
  database: Database,
  timeRange: TimeRange
): DatabaseMetricsTimeSeries {
  const dataPointCount = getDataPointCount(timeRange);

  // Generate CPU time series
  const cpu = generateDataPoints(
    database.metrics.cpu,
    dataPointCount,
    timeRange,
    { min: 10, max: 100, variationPercent: 20 }
  );

  // Generate Memory time series
  const memory = generateDataPoints(
    database.metrics.memory,
    dataPointCount,
    timeRange,
    { min: 20, max: 100, variationPercent: 15 }
  );

  // Generate Storage time series (only increases or stays flat)
  const storage = generateDataPoints(
    database.metrics.storage,
    dataPointCount,
    timeRange,
    { min: database.metrics.storage * 0.9, max: database.metrics.storage, variationPercent: 2, onlyIncrease: true }
  );

  // Generate Connections time series
  const connections = generateDataPoints(
    database.metrics.connections,
    dataPointCount,
    timeRange,
    { min: 10, max: database.metrics.maxConnections, variationPercent: 25 }
  );

  // Generate Latency time series (correlated with CPU)
  const latency = generateDataPoints(
    database.metrics.latency,
    dataPointCount,
    timeRange,
    { min: 5, max: 500, variationPercent: 30, correlateWith: cpu, correlationFactor: 0.4 }
  );

  // Generate Throughput time series (inversely correlated with latency)
  const throughput = generateDataPoints(
    database.metrics.throughput,
    dataPointCount,
    timeRange,
    { min: 100, max: 2000, variationPercent: 25, correlateWith: latency, correlationFactor: -0.3 }
  );

  // Add spikes for databases with critical health or active issues
  if (database.healthScore < 70 || database.activeIssues > 0) {
    // Add a CPU spike in the middle of the time range
    const spikeIndex = Math.floor(dataPointCount / 2);
    if (cpu[spikeIndex]) {
      cpu[spikeIndex].value = Math.min(95, cpu[spikeIndex].value * 1.5);
      // Correlate latency spike
      if (latency[spikeIndex]) {
        latency[spikeIndex].value = Math.min(400, latency[spikeIndex].value * 1.8);
      }
    }
  }

  return {
    cpu,
    memory,
    storage,
    connections,
    latency,
    throughput,
  };
}
