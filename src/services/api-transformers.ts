// Transform backend API responses to frontend types

import type {
  Database,
  DatabaseType,
  CloudProvider,
  Environment,
  HealthStatus,
  Trend,
  Issue,
  IssueSeverity,
  IssueCategory,
  IssueStatus,
  DatabaseCost,
  CostAnomaly,
  CostTimeSeries,
} from '@/types';

import type {
  ApiDatabaseResponse,
  ApiDatabaseListResponse,
  ApiDatabaseSummary,
  ApiIssueResponse,
  ApiIssueListResponse,
  ApiIssueSummary,
  ApiBillingSummaryResponse,
  ApiCostAnomalyResponse,
  ApiCostTimeSeries,
} from './api';

// ============ Database Transformers ============

function mapHealthStatus(backendStatus: string, healthScore: number): HealthStatus {
  // Backend has: healthy, warning, critical
  // Frontend has: excellent, good, warning, critical, unknown
  if (backendStatus === 'healthy') {
    return healthScore >= 90 ? 'excellent' : 'good';
  }
  if (backendStatus === 'warning') return 'warning';
  if (backendStatus === 'critical') return 'critical';
  return 'unknown';
}

function mapTrend(costTrend: number): Trend {
  if (costTrend > 5) return 'up';
  if (costTrend < -5) return 'down';
  return 'stable';
}

export function transformDatabase(apiDb: ApiDatabaseResponse): Database {
  return {
    id: apiDb.id,
    name: apiDb.name,
    type: apiDb.type as DatabaseType,
    cloud: apiDb.cloud_provider as CloudProvider,
    region: apiDb.region,
    environment: apiDb.environment as Environment,
    healthScore: apiDb.health_score,
    healthStatus: mapHealthStatus(apiDb.health_status, apiDb.health_score),
    healthTrend: 'stable', // Backend doesn't track this yet
    metrics: {
      cpu: apiDb.cpu_usage,
      memory: apiDb.memory_usage,
      storage: apiDb.storage_usage,
      connections: apiDb.connections_active,
      maxConnections: apiDb.connections_max,
      latency: 0, // Not in current backend schema
      throughput: 0, // Not in current backend schema
    },
    activeIssues: apiDb.active_issues_count,
    recentChanges: 0, // Not tracked in current backend
    monthlyCost: apiDb.monthly_cost,
    costTrend: mapTrend(apiDb.cost_trend),
    createdAt: new Date(apiDb.created_at),
    lastChecked: new Date(apiDb.last_seen_at),
    tags: apiDb.tags || {},
  };
}

export function transformDatabaseList(response: ApiDatabaseListResponse): {
  databases: Database[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  return {
    databases: response.databases.map(transformDatabase),
    total: response.total,
    page: response.page,
    pageSize: response.page_size,
    totalPages: response.total_pages,
  };
}

export interface DatabaseSummaryTransformed {
  totalDatabases: number;
  healthyDatabases: number;
  warningDatabases: number;
  criticalDatabases: number;
  byCloud: Record<string, number>;
  byType: Record<string, number>;
  byEnvironment: Record<string, number>;
}

export function transformDatabaseSummary(summary: ApiDatabaseSummary): DatabaseSummaryTransformed {
  return {
    totalDatabases: summary.total_databases,
    healthyDatabases: summary.healthy_count,
    warningDatabases: summary.warning_count,
    criticalDatabases: summary.critical_count,
    byCloud: summary.by_cloud,
    byType: summary.by_type,
    byEnvironment: summary.by_environment,
  };
}

// ============ Issue Transformers ============

export function transformIssue(apiIssue: ApiIssueResponse, databaseName?: string): Issue {
  return {
    id: apiIssue.id,
    databaseId: apiIssue.database_id,
    databaseName: databaseName || 'Unknown Database',
    severity: apiIssue.severity as IssueSeverity,
    category: apiIssue.category as IssueCategory,
    status: apiIssue.status as IssueStatus,
    title: apiIssue.title,
    description: apiIssue.description,
    explanation: apiIssue.ai_explanation || 'No AI explanation available.',
    recommendation: apiIssue.ai_recommendations?.[0] || 'Review the issue and take appropriate action.',
    detectedAt: new Date(apiIssue.first_detected_at),
    firstSeen: new Date(apiIssue.first_detected_at),
    lastSeen: new Date(apiIssue.last_detected_at),
    occurrences: apiIssue.occurrence_count,
    relatedMetrics: [], // Would need additional API call
    relatedLogs: [], // Would need additional API call
    relatedChanges: [], // Would need additional API call
    affectedServices: apiIssue.affected_services || undefined,
  };
}

export function transformIssueList(
  response: ApiIssueListResponse,
  databaseNameMap?: Map<string, string>
): {
  issues: Issue[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
} {
  return {
    issues: response.issues.map((issue) =>
      transformIssue(issue, databaseNameMap?.get(issue.database_id))
    ),
    total: response.total,
    page: response.page,
    pageSize: response.page_size,
    totalPages: response.total_pages,
  };
}

export interface IssueSummaryTransformed {
  totalIssues: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  activeCount: number;
  acknowledgedCount: number;
  resolvedCount: number;
  byCategory: Record<string, number>;
}

export function transformIssueSummary(summary: ApiIssueSummary): IssueSummaryTransformed {
  return {
    totalIssues: summary.total_issues,
    criticalCount: summary.critical_count,
    warningCount: summary.warning_count,
    infoCount: summary.info_count,
    activeCount: summary.active_count,
    acknowledgedCount: summary.acknowledged_count,
    resolvedCount: summary.resolved_count,
    byCategory: summary.by_category,
  };
}

// ============ Billing Transformers ============

export function transformCostAnomaly(
  apiAnomaly: ApiCostAnomalyResponse,
  databaseName?: string
): CostAnomaly {
  return {
    id: apiAnomaly.id,
    databaseId: apiAnomaly.database_id || '',
    databaseName: databaseName || 'Unknown Database',
    detectedAt: new Date(apiAnomaly.detected_at),
    type: apiAnomaly.anomaly_type as 'spike' | 'sustained_increase' | 'unexpected_charge',
    amount: apiAnomaly.amount,
    baseline: apiAnomaly.baseline_amount,
    explanation: apiAnomaly.explanation || 'Anomaly detected in cost pattern.',
    possibleCauses: apiAnomaly.possible_causes || [],
  };
}

export function transformCostTimeSeries(apiTimeSeries: ApiCostTimeSeries): CostTimeSeries {
  return {
    date: new Date(apiTimeSeries.date),
    total: apiTimeSeries.total_cost,
    byCloud: apiTimeSeries.by_cloud as Record<CloudProvider, number>,
    byType: apiTimeSeries.by_type as Record<DatabaseType, number>,
    byRegion: {}, // Not provided by backend in time series
  };
}

export interface BillingSummaryTransformed {
  totalCost: number;
  previousPeriodCost: number;
  costChangePercent: number;
  breakdown: {
    compute: number;
    storage: number;
    backup: number;
    dataTransfer: number;
    other: number;
  };
  forecastNextMonth: number;
  forecastConfidence: number;
  byCloud: Array<{
    cloudProvider: string;
    totalCost: number;
    databaseCount: number;
    percentage: number;
  }>;
  byType: Array<{
    databaseType: string;
    totalCost: number;
    databaseCount: number;
    percentage: number;
  }>;
  byRegion: Array<{
    region: string;
    totalCost: number;
    databaseCount: number;
    percentage: number;
  }>;
  timeSeries: CostTimeSeries[];
  anomalies: CostAnomaly[];
}

export function transformBillingSummary(
  response: ApiBillingSummaryResponse,
  databaseNameMap?: Map<string, string>
): BillingSummaryTransformed {
  return {
    totalCost: response.summary.total_cost,
    previousPeriodCost: response.summary.previous_period_cost,
    costChangePercent: response.summary.cost_change_percent,
    breakdown: {
      compute: response.summary.breakdown.compute,
      storage: response.summary.breakdown.storage,
      backup: response.summary.breakdown.backup,
      dataTransfer: response.summary.breakdown.data_transfer,
      other: response.summary.breakdown.other,
    },
    forecastNextMonth: response.summary.forecast_next_month,
    forecastConfidence: response.summary.forecast_confidence,
    byCloud: response.by_cloud.map((item) => ({
      cloudProvider: item.cloud_provider,
      totalCost: item.total_cost,
      databaseCount: item.database_count,
      percentage: item.percentage,
    })),
    byType: response.by_type.map((item) => ({
      databaseType: item.database_type,
      totalCost: item.total_cost,
      databaseCount: item.database_count,
      percentage: item.percentage,
    })),
    byRegion: response.by_region.map((item) => ({
      region: item.region,
      totalCost: item.total_cost,
      databaseCount: item.database_count,
      percentage: item.percentage,
    })),
    timeSeries: response.time_series.map(transformCostTimeSeries),
    anomalies: response.anomalies.map((a) =>
      transformCostAnomaly(a, databaseNameMap?.get(a.database_id || ''))
    ),
  };
}

// Helper function to create database costs from billing records
export function createDatabaseCosts(
  databases: Database[],
  billingSummary: BillingSummaryTransformed
): DatabaseCost[] {
  return databases.map((db) => ({
    databaseId: db.id,
    databaseName: db.name,
    totalCost: db.monthlyCost,
    breakdown: {
      compute: db.monthlyCost * 0.6, // Estimated breakdown
      storage: db.monthlyCost * 0.2,
      backup: db.monthlyCost * 0.1,
      dataTransfer: db.monthlyCost * 0.05,
      other: db.monthlyCost * 0.05,
    },
    trend: {
      change: Math.random() * 20 - 10, // Would need historical data
      direction: db.costTrend,
    },
    forecast: {
      nextMonth: db.monthlyCost * (1 + (Math.random() * 0.1 - 0.05)),
      confidence: 75 + Math.random() * 20,
    },
  }));
}
