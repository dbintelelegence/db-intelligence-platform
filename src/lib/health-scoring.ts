import type {
  ScoringMetric,
  MetricThresholdConfig,
  ScoringConfiguration,
  HealthScoreBreakdown,
  MetricScoreDetail,
  CustomMetricConfig,
} from '@/types/health-scoring';
import type { CurrentDatabaseMetrics, Database, DatabaseType } from '@/types/database';
import { getHealthStatus } from '@/constants/health-thresholds';

/**
 * Extract scoring inputs from raw database metrics.
 * Normalizes connections into a connectionRatio percentage.
 */
export function extractScoringInputs(metrics: CurrentDatabaseMetrics): Record<ScoringMetric, number> {
  const connectionRatio = metrics.maxConnections > 0
    ? (metrics.connections / metrics.maxConnections) * 100
    : 0;

  return {
    cpu: metrics.cpu,
    memory: metrics.memory,
    storage: metrics.storage,
    connectionRatio,
    latency: metrics.latency,
    throughput: metrics.throughput,
  };
}

/**
 * Compute a sub-score (0-100) for a single metric value based on threshold bands.
 * If underutilization bands are defined, checks those first — the final sub-score
 * is the minimum of the underutilization score and the overutilization score.
 */
export function computeSubScore(
  value: number,
  thresholdConfig: MetricThresholdConfig
): { subScore: number; band: string } {
  const { bands, direction, underutilizationBands } = thresholdConfig;

  // Check underutilization bands (ascending upperBound: value below the first
  // band's threshold means the resource is severely underutilized)
  let underutilResult: { subScore: number; band: string } | null = null;
  if (underutilizationBands && underutilizationBands.length > 0) {
    // Bands are ordered ascending by upperBound.
    // Walk from lowest to highest; if value is below a band's upperBound, match.
    for (const band of underutilizationBands) {
      if (value < band.upperBound) {
        underutilResult = { subScore: band.subScore, band: band.label };
        break;
      }
    }
  }

  // Compute the normal overutilization / direction-based score
  let normalResult: { subScore: number; band: string };

  if (direction === 'lower_better') {
    normalResult = { subScore: bands[bands.length - 1].subScore, band: bands[bands.length - 1].label };
    for (const band of bands) {
      if (value <= band.upperBound) {
        normalResult = { subScore: band.subScore, band: band.label };
        break;
      }
    }
  } else {
    normalResult = { subScore: bands[bands.length - 1].subScore, band: bands[bands.length - 1].label };
    for (const band of bands) {
      if (value >= band.upperBound) {
        normalResult = { subScore: band.subScore, band: band.label };
        break;
      }
    }
  }

  // If underutilization matched and is worse, use it
  if (underutilResult && underutilResult.subScore < normalResult.subScore) {
    return underutilResult;
  }

  return normalResult;
}

/**
 * Compute a sub-score for a custom metric using its own threshold config.
 */
export function computeCustomSubScore(
  value: number,
  customMetric: CustomMetricConfig
): { subScore: number; band: string } {
  const { bands, direction } = customMetric;

  if (direction === 'lower_better') {
    for (const band of bands) {
      if (value <= band.upperBound) {
        return { subScore: band.subScore, band: band.label };
      }
    }
    const lastBand = bands[bands.length - 1];
    return { subScore: lastBand.subScore, band: lastBand.label };
  } else {
    for (const band of bands) {
      if (value >= band.upperBound) {
        return { subScore: band.subScore, band: band.label };
      }
    }
    const lastBand = bands[bands.length - 1];
    return { subScore: lastBand.subScore, band: lastBand.label };
  }
}

/**
 * Compute the overall health score for a database given its metrics, type, and scoring config.
 * Optionally includes the type-specific custom metric if present.
 */
export function computeHealthScore(
  metrics: CurrentDatabaseMetrics,
  dbType: DatabaseType,
  config: ScoringConfiguration,
  typeSpecificMetrics?: Record<string, number>
): HealthScoreBreakdown {
  const inputs = extractScoringInputs(metrics);
  const profile = config.profiles.find(p => p.dbType === dbType);

  if (!profile) {
    throw new Error(`No scoring profile found for database type: ${dbType}`);
  }

  const metricScores = {} as Record<ScoringMetric, MetricScoreDetail>;
  let overallScore = 0;

  // Determine what fraction goes to standard metrics vs custom metric
  const customMetric = profile.customMetric;
  const customWeight = customMetric ? customMetric.weight : 0;
  const standardScale = 1.0 - customWeight; // standard weights are scaled to fill the remaining fraction

  const scoringMetrics: ScoringMetric[] = ['cpu', 'memory', 'storage', 'connectionRatio', 'latency', 'throughput'];

  for (const metric of scoringMetrics) {
    const thresholdConfig = config.metricThresholds.find(t => t.metric === metric);
    if (!thresholdConfig) continue;

    const rawValue = inputs[metric];
    const { subScore, band } = computeSubScore(rawValue, thresholdConfig);
    const weight = profile.weights[metric] * standardScale;
    const weightedContribution = subScore * weight;

    metricScores[metric] = {
      rawValue,
      subScore,
      weight,
      weightedContribution,
      band,
    };

    overallScore += weightedContribution;
  }

  // Include custom metric if available
  let customMetricScore: HealthScoreBreakdown['customMetricScore'];
  if (customMetric && typeSpecificMetrics && typeSpecificMetrics[customMetric.key] !== undefined) {
    const rawValue = typeSpecificMetrics[customMetric.key];
    const { subScore, band } = computeCustomSubScore(rawValue, customMetric);
    const weightedContribution = subScore * customWeight;

    customMetricScore = {
      key: customMetric.key,
      displayName: customMetric.displayName,
      rawValue,
      subScore,
      weight: customWeight,
      weightedContribution,
      band,
    };

    overallScore += weightedContribution;
  }

  return {
    overallScore: Math.round(overallScore),
    metricScores,
    customMetricScore,
  };
}

/**
 * Recalculate a database's health score and status from its metrics.
 * Returns a new Database object with updated healthScore and healthStatus.
 */
export function recalculateDatabaseHealth(
  db: Database,
  config: ScoringConfiguration
): Database {
  if (db.healthScore === -1) {
    // Unknown status — preserve as-is
    return db;
  }

  const breakdown = computeHealthScore(db.metrics, db.type, config, db.typeSpecificMetrics);

  return {
    ...db,
    healthScore: breakdown.overallScore,
    healthStatus: getHealthStatus(breakdown.overallScore),
  };
}

/**
 * Validate that weights for a scoring profile sum to approximately 1.0.
 */
export function validateWeights(weights: Record<ScoringMetric, number>): {
  valid: boolean;
  sum: number;
} {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return {
    valid: Math.abs(sum - 1.0) < 0.01,
    sum: Math.round(sum * 100) / 100,
  };
}
