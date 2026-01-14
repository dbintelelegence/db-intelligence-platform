// API Client for DB Intelligence Platform Backend

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const API_V1_PREFIX = '/api/v1';

// API Response Types (matching backend schemas)
export interface ApiDatabaseResponse {
  id: string;
  name: string;
  type: string;
  cloud_provider: string;
  region: string;
  environment: string;
  health_status: string;
  health_score: number;
  cpu_usage: number;
  memory_usage: number;
  storage_usage: number;
  connections_active: number;
  connections_max: number;
  monthly_cost: number;
  cost_trend: number;
  active_issues_count: number;
  version: string | null;
  instance_type: string | null;
  storage_size_gb: number | null;
  tags: Record<string, string> | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
}

export interface ApiDatabaseListResponse {
  databases: ApiDatabaseResponse[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiDatabaseSummary {
  total_databases: number;
  healthy_count: number;
  warning_count: number;
  critical_count: number;
  by_cloud: Record<string, number>;
  by_type: Record<string, number>;
  by_environment: Record<string, number>;
}

export interface ApiIssueResponse {
  id: string;
  database_id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  status: string;
  ai_explanation: string | null;
  ai_recommendations: string[] | null;
  related_metrics: Record<string, unknown>[] | null;
  affected_services: string[] | null;
  occurrence_count: number;
  first_detected_at: string;
  last_detected_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiIssueListResponse {
  issues: ApiIssueResponse[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiIssueSummary {
  total_issues: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  active_count: number;
  acknowledged_count: number;
  resolved_count: number;
  by_category: Record<string, number>;
}

export interface ApiCostSummary {
  total_cost: number;
  previous_period_cost: number;
  cost_change_percent: number;
  breakdown: {
    compute: number;
    storage: number;
    backup: number;
    data_transfer: number;
    other: number;
  };
  forecast_next_month: number;
  forecast_confidence: number;
}

export interface ApiCostByCloud {
  cloud_provider: string;
  total_cost: number;
  database_count: number;
  percentage: number;
}

export interface ApiCostByType {
  database_type: string;
  total_cost: number;
  database_count: number;
  percentage: number;
}

export interface ApiCostByRegion {
  region: string;
  total_cost: number;
  database_count: number;
  percentage: number;
}

export interface ApiCostTimeSeries {
  date: string;
  total_cost: number;
  by_cloud: Record<string, number>;
  by_type: Record<string, number>;
}

export interface ApiCostAnomalyResponse {
  id: string;
  database_id: string | null;
  anomaly_type: string;
  amount: number;
  baseline_amount: number;
  deviation_percent: number;
  explanation: string | null;
  possible_causes: string[] | null;
  detected_at: string;
  period_start: string | null;
  period_end: string | null;
  is_acknowledged: boolean;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
}

export interface ApiBillingSummaryResponse {
  summary: ApiCostSummary;
  by_cloud: ApiCostByCloud[];
  by_type: ApiCostByType[];
  by_region: ApiCostByRegion[];
  time_series: ApiCostTimeSeries[];
  anomalies: ApiCostAnomalyResponse[];
}

export interface ApiBillingRecordResponse {
  id: string;
  database_id: string;
  billing_date: string;
  total_cost: number;
  compute_cost: number;
  storage_cost: number;
  backup_cost: number;
  data_transfer_cost: number;
  other_cost: number;
  compute_hours: number | null;
  storage_gb: number | null;
  data_transfer_gb: number | null;
  currency: string;
  billing_source: string | null;
  created_at: string;
}

// API Error class
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Base fetch wrapper
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${API_V1_PREFIX}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    let errorDetails;
    try {
      errorDetails = await response.json();
    } catch {
      errorDetails = await response.text();
    }
    throw new ApiError(response.status, `API request failed: ${response.statusText}`, errorDetails);
  }

  return response.json();
}

// Query params builder
function buildQueryParams(params: Record<string, unknown>): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.append(key, String(value));
    }
  });
  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

// ============ Database API ============

export interface DatabaseFilters {
  page?: number;
  page_size?: number;
  cloud_provider?: string;
  database_type?: string;
  environment?: string;
  health_status?: string;
  region?: string;
  search?: string;
}

export async function fetchDatabases(filters: DatabaseFilters = {}): Promise<ApiDatabaseListResponse> {
  const queryParams = buildQueryParams(filters);
  return apiFetch<ApiDatabaseListResponse>(`/databases${queryParams}`);
}

export async function fetchDatabaseById(id: string): Promise<ApiDatabaseResponse> {
  return apiFetch<ApiDatabaseResponse>(`/databases/${id}`);
}

export async function fetchDatabaseSummary(): Promise<ApiDatabaseSummary> {
  return apiFetch<ApiDatabaseSummary>('/databases/summary');
}

// ============ Issues API ============

export interface IssueFilters {
  page?: number;
  page_size?: number;
  severity?: string;
  category?: string;
  status?: string;
  database_id?: string;
}

export async function fetchIssues(filters: IssueFilters = {}): Promise<ApiIssueListResponse> {
  const queryParams = buildQueryParams(filters);
  return apiFetch<ApiIssueListResponse>(`/issues${queryParams}`);
}

export async function fetchIssueById(id: string): Promise<ApiIssueResponse> {
  return apiFetch<ApiIssueResponse>(`/issues/${id}`);
}

export async function fetchIssueSummary(): Promise<ApiIssueSummary> {
  return apiFetch<ApiIssueSummary>('/issues/summary');
}

export async function acknowledgeIssue(id: string, acknowledgedBy: string): Promise<ApiIssueResponse> {
  return apiFetch<ApiIssueResponse>(`/issues/${id}/acknowledge`, {
    method: 'POST',
    body: JSON.stringify({ acknowledged_by: acknowledgedBy }),
  });
}

export async function resolveIssue(id: string, resolvedBy: string): Promise<ApiIssueResponse> {
  return apiFetch<ApiIssueResponse>(`/issues/${id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ resolved_by: resolvedBy }),
  });
}

// ============ Billing API ============

export interface BillingFilters {
  start_date?: string;
  end_date?: string;
}

export async function fetchBillingSummary(filters: BillingFilters = {}): Promise<ApiBillingSummaryResponse> {
  const queryParams = buildQueryParams(filters);
  return apiFetch<ApiBillingSummaryResponse>(`/billing/summary${queryParams}`);
}

export async function fetchBillingByDatabase(databaseId: string): Promise<ApiBillingRecordResponse[]> {
  return apiFetch<ApiBillingRecordResponse[]>(`/billing/databases/${databaseId}`);
}

export interface AnomalyFilters {
  acknowledged?: boolean;
  limit?: number;
}

export async function fetchCostAnomalies(filters: AnomalyFilters = {}): Promise<ApiCostAnomalyResponse[]> {
  const queryParams = buildQueryParams(filters);
  return apiFetch<ApiCostAnomalyResponse[]>(`/billing/anomalies${queryParams}`);
}

export async function acknowledgeCostAnomaly(id: string, acknowledgedBy: string): Promise<ApiCostAnomalyResponse> {
  return apiFetch<ApiCostAnomalyResponse>(`/billing/anomalies/${id}/acknowledge?acknowledged_by=${encodeURIComponent(acknowledgedBy)}`, {
    method: 'POST',
  });
}

// ============ Metrics API ============

export interface ApiCurrentMetrics {
  cpu_usage: number;
  memory_usage: number;
  storage_usage: number;
  connections_active: number;
  connections_max: number;
  latency_avg_ms: number | null;
  throughput_qps: number | null;
  replication_lag_ms: number | null;
}

export interface ApiMetricDataPoint {
  timestamp: string;
  value: number;
}

export interface ApiMetricTimeSeries {
  database_id: string;
  metric_name: string;
  unit: string | null;
  data_points: ApiMetricDataPoint[];
  min_value: number;
  max_value: number;
  avg_value: number;
}

export async function fetchCurrentMetrics(databaseId: string): Promise<ApiCurrentMetrics> {
  return apiFetch<ApiCurrentMetrics>(`/metrics/databases/${databaseId}/current`);
}

export async function fetchMetricTimeSeries(
  databaseId: string,
  metricName: string,
  timeWindow: string = '24h'
): Promise<ApiMetricTimeSeries> {
  return apiFetch<ApiMetricTimeSeries>(
    `/metrics/databases/${databaseId}/timeseries/${metricName}?time_window=${timeWindow}`
  );
}

export async function fetchAvailableMetrics(databaseId: string): Promise<string[]> {
  return apiFetch<string[]>(`/metrics/databases/${databaseId}/available`);
}
