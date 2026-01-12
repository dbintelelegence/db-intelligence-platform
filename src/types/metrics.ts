export interface MetricDataPoint {
  timestamp: Date;
  value: number;
}

export interface MetricTimeSeries {
  metric: string;           // e.g., 'cpu', 'memory'
  label: string;            // e.g., 'CPU Usage'
  unit: string;             // e.g., '%', 'ms', 'qps'
  data: MetricDataPoint[];
  current: number;          // Current value
  average: number;          // Average value
  peak: number;             // Peak value
  threshold?: number;       // Optional threshold for alerting
}

export interface DatabaseMetrics {
  databaseId: string;
  timeRange: TimeRange;
  metrics: {
    cpu: MetricTimeSeries;
    memory: MetricTimeSeries;
    storage: MetricTimeSeries;
    connections: MetricTimeSeries;
    latency: MetricTimeSeries;
    throughput: MetricTimeSeries;
    iops: MetricTimeSeries;
  };
}

export interface TimeRange {
  start: Date;
  end: Date;
  label: string;            // e.g., 'Last 24 hours'
}
