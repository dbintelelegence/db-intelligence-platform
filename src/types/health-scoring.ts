import type { DatabaseType, Environment } from './database';

export type ScoringMetric = 'cpu' | 'memory' | 'storage' | 'connectionRatio' | 'latency' | 'throughput';

export interface MetricThresholdBand {
  label: string;
  upperBound: number;
  subScore: number;
}

export interface MetricThresholdConfig {
  metric: ScoringMetric;
  displayName: string;
  unit: string;
  direction: 'lower_better' | 'higher_better';
  bands: MetricThresholdBand[];
  /** Optional bands that penalize under-utilization (too-low values). Ascending order. */
  underutilizationBands?: MetricThresholdBand[];
}

export interface CustomMetricConfig {
  key: string;
  displayName: string;
  unit: string;
  direction: 'lower_better' | 'higher_better';
  bands: MetricThresholdBand[];
  weight: number;
}

export interface DatabaseScoringProfile {
  dbType: DatabaseType;
  displayName: string;
  description: string;
  weights: Record<ScoringMetric, number>;
  /** Type-specific custom metric that factors into the health score */
  customMetric?: CustomMetricConfig;
}

export interface ScoringConfiguration {
  metricThresholds: MetricThresholdConfig[];
  profiles: DatabaseScoringProfile[];
}

export interface MetricScoreDetail {
  rawValue: number;
  subScore: number;
  weight: number;
  weightedContribution: number;
  band: string;
}

/** Full scoring configuration keyed by environment */
export type EnvironmentScoringConfigurations = Record<Environment, ScoringConfiguration>;

export interface HealthScoreBreakdown {
  overallScore: number;
  metricScores: Record<ScoringMetric, MetricScoreDetail>;
  customMetricScore?: MetricScoreDetail & { key: string; displayName: string };
}
