import type {
  ScoringConfiguration,
  EnvironmentScoringConfigurations,
  MetricThresholdConfig,
  DatabaseScoringProfile,
  DatabaseType,
  Environment,
} from '@/types';

const STORAGE_KEY = 'db-intelligence-scoring-config-v2';

// ─── Production thresholds (strictest) ──────────────────────────────────────

const PRODUCTION_THRESHOLDS: MetricThresholdConfig[] = [
  {
    metric: 'cpu',
    displayName: 'CPU Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 50, subScore: 100 },
      { label: 'Elevated', upperBound: 70, subScore: 80 },
      { label: 'Warning', upperBound: 85, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 5, subScore: 40 },
      { label: 'Underutilized', upperBound: 15, subScore: 65 },
    ],
  },
  {
    metric: 'memory',
    displayName: 'Memory Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 60, subScore: 100 },
      { label: 'Elevated', upperBound: 75, subScore: 80 },
      { label: 'Warning', upperBound: 85, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 10, subScore: 40 },
      { label: 'Underutilized', upperBound: 25, subScore: 65 },
    ],
  },
  {
    metric: 'storage',
    displayName: 'Storage Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 60, subScore: 100 },
      { label: 'Elevated', upperBound: 75, subScore: 80 },
      { label: 'Warning', upperBound: 85, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 10, subScore: 40 },
      { label: 'Underutilized', upperBound: 20, subScore: 65 },
    ],
  },
  {
    metric: 'connectionRatio',
    displayName: 'Connection Ratio',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 50, subScore: 100 },
      { label: 'Elevated', upperBound: 70, subScore: 80 },
      { label: 'Warning', upperBound: 85, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 5, subScore: 50 },
      { label: 'Underutilized', upperBound: 15, subScore: 70 },
    ],
  },
  {
    metric: 'latency',
    displayName: 'Latency',
    unit: 'ms',
    direction: 'lower_better',
    bands: [
      { label: 'Excellent', upperBound: 20, subScore: 100 },
      { label: 'Good', upperBound: 50, subScore: 80 },
      { label: 'Warning', upperBound: 100, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
  },
  {
    metric: 'throughput',
    displayName: 'Throughput',
    unit: 'qps',
    direction: 'higher_better',
    bands: [
      { label: 'Excellent', upperBound: 1000, subScore: 100 },
      { label: 'Good', upperBound: 500, subScore: 80 },
      { label: 'Warning', upperBound: 200, subScore: 50 },
      { label: 'Critical', upperBound: 0, subScore: 20 },
    ],
  },
];

// ─── Staging thresholds (moderately relaxed) ────────────────────────────────

const STAGING_THRESHOLDS: MetricThresholdConfig[] = [
  {
    metric: 'cpu',
    displayName: 'CPU Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 60, subScore: 100 },
      { label: 'Elevated', upperBound: 80, subScore: 80 },
      { label: 'Warning', upperBound: 90, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 3, subScore: 55 },
      { label: 'Underutilized', upperBound: 10, subScore: 75 },
    ],
  },
  {
    metric: 'memory',
    displayName: 'Memory Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 70, subScore: 100 },
      { label: 'Elevated', upperBound: 80, subScore: 80 },
      { label: 'Warning', upperBound: 90, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 5, subScore: 55 },
      { label: 'Underutilized', upperBound: 15, subScore: 75 },
    ],
  },
  {
    metric: 'storage',
    displayName: 'Storage Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 70, subScore: 100 },
      { label: 'Elevated', upperBound: 80, subScore: 80 },
      { label: 'Warning', upperBound: 90, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 5, subScore: 55 },
      { label: 'Underutilized', upperBound: 15, subScore: 75 },
    ],
  },
  {
    metric: 'connectionRatio',
    displayName: 'Connection Ratio',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 60, subScore: 100 },
      { label: 'Elevated', upperBound: 75, subScore: 80 },
      { label: 'Warning', upperBound: 90, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    underutilizationBands: [
      { label: 'Idle', upperBound: 3, subScore: 60 },
      { label: 'Underutilized', upperBound: 10, subScore: 80 },
    ],
  },
  {
    metric: 'latency',
    displayName: 'Latency',
    unit: 'ms',
    direction: 'lower_better',
    bands: [
      { label: 'Excellent', upperBound: 30, subScore: 100 },
      { label: 'Good', upperBound: 80, subScore: 80 },
      { label: 'Warning', upperBound: 150, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
  },
  {
    metric: 'throughput',
    displayName: 'Throughput',
    unit: 'qps',
    direction: 'higher_better',
    bands: [
      { label: 'Excellent', upperBound: 800, subScore: 100 },
      { label: 'Good', upperBound: 400, subScore: 80 },
      { label: 'Warning', upperBound: 100, subScore: 50 },
      { label: 'Critical', upperBound: 0, subScore: 20 },
    ],
  },
];

// ─── QA thresholds (relaxed utilization, strict on performance) ─────────────

const QA_THRESHOLDS: MetricThresholdConfig[] = [
  {
    metric: 'cpu',
    displayName: 'CPU Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 70, subScore: 100 },
      { label: 'Elevated', upperBound: 85, subScore: 80 },
      { label: 'Warning', upperBound: 95, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
    // QA environments are often idle — no underutilization penalty
  },
  {
    metric: 'memory',
    displayName: 'Memory Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 75, subScore: 100 },
      { label: 'Elevated', upperBound: 85, subScore: 80 },
      { label: 'Warning', upperBound: 95, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
  },
  {
    metric: 'storage',
    displayName: 'Storage Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 75, subScore: 100 },
      { label: 'Elevated', upperBound: 85, subScore: 80 },
      { label: 'Warning', upperBound: 95, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
  },
  {
    metric: 'connectionRatio',
    displayName: 'Connection Ratio',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 65, subScore: 100 },
      { label: 'Elevated', upperBound: 80, subScore: 80 },
      { label: 'Warning', upperBound: 90, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
  },
  {
    metric: 'latency',
    displayName: 'Latency',
    unit: 'ms',
    direction: 'lower_better',
    bands: [
      { label: 'Excellent', upperBound: 25, subScore: 100 },
      { label: 'Good', upperBound: 60, subScore: 80 },
      { label: 'Warning', upperBound: 120, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
  },
  {
    metric: 'throughput',
    displayName: 'Throughput',
    unit: 'qps',
    direction: 'higher_better',
    bands: [
      { label: 'Excellent', upperBound: 800, subScore: 100 },
      { label: 'Good', upperBound: 300, subScore: 80 },
      { label: 'Warning', upperBound: 100, subScore: 50 },
      { label: 'Critical', upperBound: 0, subScore: 20 },
    ],
  },
];

// ─── Development thresholds (very relaxed) ──────────────────────────────────

const DEVELOPMENT_THRESHOLDS: MetricThresholdConfig[] = [
  {
    metric: 'cpu',
    displayName: 'CPU Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 80, subScore: 100 },
      { label: 'Elevated', upperBound: 90, subScore: 80 },
      { label: 'Warning', upperBound: 95, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 30 },
    ],
    // No underutilization penalty in dev — DBs are often idle
  },
  {
    metric: 'memory',
    displayName: 'Memory Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 80, subScore: 100 },
      { label: 'Elevated', upperBound: 90, subScore: 80 },
      { label: 'Warning', upperBound: 95, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 30 },
    ],
  },
  {
    metric: 'storage',
    displayName: 'Storage Usage',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 80, subScore: 100 },
      { label: 'Elevated', upperBound: 90, subScore: 80 },
      { label: 'Warning', upperBound: 95, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 30 },
    ],
  },
  {
    metric: 'connectionRatio',
    displayName: 'Connection Ratio',
    unit: '%',
    direction: 'lower_better',
    bands: [
      { label: 'Optimal', upperBound: 70, subScore: 100 },
      { label: 'Elevated', upperBound: 85, subScore: 80 },
      { label: 'Warning', upperBound: 95, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 30 },
    ],
  },
  {
    metric: 'latency',
    displayName: 'Latency',
    unit: 'ms',
    direction: 'lower_better',
    bands: [
      { label: 'Excellent', upperBound: 50, subScore: 100 },
      { label: 'Good', upperBound: 150, subScore: 80 },
      { label: 'Warning', upperBound: 300, subScore: 50 },
      { label: 'Critical', upperBound: Infinity, subScore: 20 },
    ],
  },
  {
    metric: 'throughput',
    displayName: 'Throughput',
    unit: 'qps',
    direction: 'higher_better',
    bands: [
      { label: 'Excellent', upperBound: 500, subScore: 100 },
      { label: 'Good', upperBound: 200, subScore: 80 },
      { label: 'Warning', upperBound: 50, subScore: 50 },
      { label: 'Critical', upperBound: 0, subScore: 20 },
    ],
  },
];

// ─── Database-type profiles (shared across all environments) ────────────────

const DEFAULT_PROFILES: DatabaseScoringProfile[] = [
  {
    dbType: 'postgres', displayName: 'PostgreSQL',
    description: 'Connection-heavy RDBMS — weights connection pool utilization highest.',
    weights: { cpu: 0.20, memory: 0.15, storage: 0.15, connectionRatio: 0.25, latency: 0.15, throughput: 0.10 },
    customMetric: { key: 'replicationLag', displayName: 'Replication Lag', unit: 's', direction: 'lower_better', weight: 0.10,
      bands: [{ label: 'Excellent', upperBound: 1, subScore: 100 }, { label: 'Good', upperBound: 5, subScore: 80 }, { label: 'Warning', upperBound: 30, subScore: 50 }, { label: 'Critical', upperBound: Infinity, subScore: 20 }] },
  },
  {
    dbType: 'mysql', displayName: 'MySQL',
    description: 'Balanced RDBMS with emphasis on storage and connections.',
    weights: { cpu: 0.20, memory: 0.15, storage: 0.20, connectionRatio: 0.20, latency: 0.15, throughput: 0.10 },
    customMetric: { key: 'slowQueryRatio', displayName: 'Slow Query Ratio', unit: '%', direction: 'lower_better', weight: 0.10,
      bands: [{ label: 'Excellent', upperBound: 1, subScore: 100 }, { label: 'Good', upperBound: 5, subScore: 80 }, { label: 'Warning', upperBound: 15, subScore: 50 }, { label: 'Critical', upperBound: Infinity, subScore: 20 }] },
  },
  {
    dbType: 'mongodb', displayName: 'MongoDB',
    description: 'Document store — memory and storage are key for working set and data size.',
    weights: { cpu: 0.15, memory: 0.25, storage: 0.20, connectionRatio: 0.10, latency: 0.15, throughput: 0.15 },
    customMetric: { key: 'lockContention', displayName: 'Lock Contention', unit: '%', direction: 'lower_better', weight: 0.10,
      bands: [{ label: 'Excellent', upperBound: 2, subScore: 100 }, { label: 'Good', upperBound: 10, subScore: 80 }, { label: 'Warning', upperBound: 25, subScore: 50 }, { label: 'Critical', upperBound: Infinity, subScore: 20 }] },
  },
  {
    dbType: 'redis', displayName: 'Redis',
    description: 'In-memory cache — memory usage and latency are critical.',
    weights: { cpu: 0.10, memory: 0.35, storage: 0.05, connectionRatio: 0.10, latency: 0.25, throughput: 0.15 },
    customMetric: { key: 'evictionRate', displayName: 'Eviction Rate', unit: 'evictions/s', direction: 'lower_better', weight: 0.10,
      bands: [{ label: 'Excellent', upperBound: 10, subScore: 100 }, { label: 'Good', upperBound: 100, subScore: 80 }, { label: 'Warning', upperBound: 500, subScore: 50 }, { label: 'Critical', upperBound: Infinity, subScore: 20 }] },
  },
  {
    dbType: 'dynamodb', displayName: 'DynamoDB',
    description: 'Managed NoSQL — throughput and latency dominate (compute/storage managed by AWS).',
    weights: { cpu: 0.05, memory: 0.05, storage: 0.10, connectionRatio: 0.10, latency: 0.30, throughput: 0.40 },
    customMetric: { key: 'throttledRequests', displayName: 'Throttled Requests', unit: '%', direction: 'lower_better', weight: 0.15,
      bands: [{ label: 'Excellent', upperBound: 0.5, subScore: 100 }, { label: 'Good', upperBound: 2, subScore: 80 }, { label: 'Warning', upperBound: 10, subScore: 50 }, { label: 'Critical', upperBound: Infinity, subScore: 20 }] },
  },
  {
    dbType: 'aurora', displayName: 'Aurora',
    description: 'Cloud-native RDBMS — balanced profile similar to PostgreSQL/MySQL.',
    weights: { cpu: 0.20, memory: 0.15, storage: 0.20, connectionRatio: 0.20, latency: 0.15, throughput: 0.10 },
    customMetric: { key: 'bufferCacheHitRatio', displayName: 'Buffer Cache Hit Ratio', unit: '%', direction: 'higher_better', weight: 0.10,
      bands: [{ label: 'Excellent', upperBound: 99, subScore: 100 }, { label: 'Good', upperBound: 95, subScore: 80 }, { label: 'Warning', upperBound: 85, subScore: 50 }, { label: 'Critical', upperBound: 0, subScore: 20 }] },
  },
  {
    dbType: 'elasticsearch', displayName: 'Elasticsearch',
    description: 'Search engine — CPU and memory intensive for indexing and queries.',
    weights: { cpu: 0.20, memory: 0.25, storage: 0.20, connectionRatio: 0.05, latency: 0.15, throughput: 0.15 },
    customMetric: { key: 'shardBalance', displayName: 'Shard Balance', unit: '%', direction: 'higher_better', weight: 0.10,
      bands: [{ label: 'Excellent', upperBound: 90, subScore: 100 }, { label: 'Good', upperBound: 70, subScore: 80 }, { label: 'Warning', upperBound: 50, subScore: 50 }, { label: 'Critical', upperBound: 0, subScore: 20 }] },
  },
];

// ─── Assemble per-environment configurations ────────────────────────────────

export const DEFAULT_ENV_SCORING_CONFIGURATIONS: EnvironmentScoringConfigurations = {
  production: { metricThresholds: PRODUCTION_THRESHOLDS, profiles: DEFAULT_PROFILES },
  staging:    { metricThresholds: STAGING_THRESHOLDS,    profiles: DEFAULT_PROFILES },
  qa:         { metricThresholds: QA_THRESHOLDS,         profiles: DEFAULT_PROFILES },
  development:{ metricThresholds: DEVELOPMENT_THRESHOLDS,profiles: DEFAULT_PROFILES },
};

/** Kept for backwards compatibility — returns the production config */
export const DEFAULT_SCORING_CONFIGURATION: ScoringConfiguration =
  DEFAULT_ENV_SCORING_CONFIGURATIONS.production;

// ─── Persistence ────────────────────────────────────────────────────────────

export function loadEnvScoringConfigurations(): EnvironmentScoringConfigurations {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as EnvironmentScoringConfigurations;
    }
  } catch {
    // Fall through to defaults
  }
  return structuredClone(DEFAULT_ENV_SCORING_CONFIGURATIONS);
}

export function saveEnvScoringConfigurations(configs: EnvironmentScoringConfigurations): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
}

export function resetEnvScoringConfigurations(): EnvironmentScoringConfigurations {
  localStorage.removeItem(STORAGE_KEY);
  return structuredClone(DEFAULT_ENV_SCORING_CONFIGURATIONS);
}

export function resetEnvProfileToDefault(
  env: Environment,
  dbType: DatabaseType,
  configs: EnvironmentScoringConfigurations
): EnvironmentScoringConfigurations {
  const defaultProfile = DEFAULT_PROFILES.find(p => p.dbType === dbType);
  if (!defaultProfile) return configs;

  return {
    ...configs,
    [env]: {
      ...configs[env],
      profiles: configs[env].profiles.map(p =>
        p.dbType === dbType ? structuredClone(defaultProfile) : p
      ),
    },
  };
}

export function resetEnvThresholdsToDefault(
  env: Environment,
  configs: EnvironmentScoringConfigurations
): EnvironmentScoringConfigurations {
  return {
    ...configs,
    [env]: {
      ...configs[env],
      metricThresholds: structuredClone(DEFAULT_ENV_SCORING_CONFIGURATIONS[env].metricThresholds),
    },
  };
}

// ─── Legacy single-config helpers (used by mock data generator) ─────────────

export function loadScoringConfiguration(): ScoringConfiguration {
  const envConfigs = loadEnvScoringConfigurations();
  return envConfigs.production;
}

export function saveScoringConfiguration(config: ScoringConfiguration): void {
  const envConfigs = loadEnvScoringConfigurations();
  envConfigs.production = config;
  saveEnvScoringConfigurations(envConfigs);
}

export function resetScoringConfiguration(): ScoringConfiguration {
  return structuredClone(DEFAULT_SCORING_CONFIGURATION);
}

export function resetProfileToDefault(dbType: DatabaseType, config: ScoringConfiguration): ScoringConfiguration {
  const defaultProfile = DEFAULT_PROFILES.find(p => p.dbType === dbType);
  if (!defaultProfile) return config;
  return {
    ...config,
    profiles: config.profiles.map(p =>
      p.dbType === dbType ? structuredClone(defaultProfile) : p
    ),
  };
}

export function resetThresholdsToDefault(config: ScoringConfiguration): ScoringConfiguration {
  return {
    ...config,
    metricThresholds: structuredClone(PRODUCTION_THRESHOLDS),
  };
}
