export type DatabaseType = 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'dynamodb' | 'aurora' | 'elasticsearch';
export type CloudProvider = 'aws' | 'gcp' | 'azure';
export type Environment = 'production' | 'staging' | 'development';
export type HealthStatus = 'excellent' | 'good' | 'warning' | 'critical' | 'unknown';
export type Trend = 'up' | 'down' | 'stable';

export interface CurrentDatabaseMetrics {
  cpu: number;              // percentage (0-100)
  memory: number;           // percentage (0-100)
  storage: number;          // percentage (0-100)
  connections: number;      // current connections
  maxConnections: number;   // maximum connections
  latency: number;          // milliseconds
  throughput: number;       // queries per second
}

export interface Database {
  id: string;
  name: string;
  type: DatabaseType;
  cloud: CloudProvider;
  region: string;
  environment: Environment;

  // Health
  healthScore: number;      // 0-100
  healthStatus: HealthStatus;
  healthTrend: Trend;

  // Metrics
  metrics: CurrentDatabaseMetrics;

  // Counts
  activeIssues: number;
  recentChanges: number;

  // Cost
  monthlyCost: number;      // USD
  costTrend: Trend;

  // Metadata
  createdAt: Date;
  lastChecked: Date;
  tags: Record<string, string>;
}
