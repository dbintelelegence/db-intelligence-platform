export type DatabaseType = 'postgres' | 'mysql' | 'mongodb' | 'redis' | 'dynamodb' | 'aurora' | 'elasticsearch';
export type CloudProvider = 'aws' | 'gcp' | 'azure';
export type Environment = 'production' | 'staging' | 'qa' | 'development';
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

  // Type-specific metrics (e.g., replication lag for Postgres, shard balance for ES)
  typeSpecificMetrics?: Record<string, number>;

  // Counts
  activeIssues: number;
  recentChanges: number;

  // Cost
  monthlyCost: number;  // 0 = not available (cost not wired up yet)
  costTrend: Trend;

  // Metadata
  createdAt: Date;
  lastChecked: Date | null;         // null if cluster has never been analyzed
  verdictAgeSeconds: number | null; // seconds since last analyzer run; null if never run
  isStale: boolean;                 // true if last run was >30 min ago
  tags: Record<string, string>;
}
