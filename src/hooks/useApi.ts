// React Query hooks for API data fetching

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchDatabases,
  fetchDatabaseById,
  fetchDatabaseSummary,
  fetchIssues,
  fetchIssueById,
  fetchIssueSummary,
  acknowledgeIssue,
  resolveIssue,
  fetchBillingSummary,
  fetchCostAnomalies,
  acknowledgeCostAnomaly,
  fetchCurrentMetrics,
  fetchMetricTimeSeries,
  type DatabaseFilters,
  type IssueFilters,
  type BillingFilters,
} from '@/services/api';

import {
  transformDatabase,
  transformDatabaseList,
  transformDatabaseSummary,
  transformIssue,
  transformIssueList,
  transformIssueSummary,
  transformBillingSummary,
  transformCostAnomaly,
  createDatabaseCosts,
} from '@/services/api-transformers';

// Query keys for cache management
export const queryKeys = {
  databases: {
    all: ['databases'] as const,
    list: (filters: DatabaseFilters) => ['databases', 'list', filters] as const,
    detail: (id: string) => ['databases', 'detail', id] as const,
    summary: ['databases', 'summary'] as const,
  },
  issues: {
    all: ['issues'] as const,
    list: (filters: IssueFilters) => ['issues', 'list', filters] as const,
    detail: (id: string) => ['issues', 'detail', id] as const,
    summary: ['issues', 'summary'] as const,
  },
  billing: {
    all: ['billing'] as const,
    summary: (filters: BillingFilters) => ['billing', 'summary', filters] as const,
    anomalies: ['billing', 'anomalies'] as const,
  },
  metrics: {
    current: (databaseId: string) => ['metrics', 'current', databaseId] as const,
    timeSeries: (databaseId: string, metricName: string, timeWindow: string) =>
      ['metrics', 'timeSeries', databaseId, metricName, timeWindow] as const,
  },
};

// ============ Database Hooks ============

export function useDatabases(filters: DatabaseFilters = {}) {
  return useQuery({
    queryKey: queryKeys.databases.list(filters),
    queryFn: async () => {
      const response = await fetchDatabases(filters);
      return transformDatabaseList(response);
    },
    staleTime: 30000, // 30 seconds
  });
}

export function useDatabase(id: string) {
  return useQuery({
    queryKey: queryKeys.databases.detail(id),
    queryFn: async () => {
      const response = await fetchDatabaseById(id);
      return transformDatabase(response);
    },
    enabled: !!id,
    staleTime: 30000,
  });
}

export function useDatabaseSummary() {
  return useQuery({
    queryKey: queryKeys.databases.summary,
    queryFn: async () => {
      const response = await fetchDatabaseSummary();
      return transformDatabaseSummary(response);
    },
    staleTime: 30000,
  });
}

// ============ Issue Hooks ============

export function useIssues(filters: IssueFilters = {}) {
  // Get databases to map database names
  const { data: databasesData } = useDatabases({ page_size: 100 });

  return useQuery({
    queryKey: queryKeys.issues.list(filters),
    queryFn: async () => {
      const response = await fetchIssues(filters);

      // Create database name map
      const databaseNameMap = new Map<string, string>();
      if (databasesData?.databases) {
        databasesData.databases.forEach((db) => {
          databaseNameMap.set(db.id, db.name);
        });
      }

      return transformIssueList(response, databaseNameMap);
    },
    staleTime: 30000,
  });
}

export function useIssue(id: string) {
  return useQuery({
    queryKey: queryKeys.issues.detail(id),
    queryFn: async () => {
      const response = await fetchIssueById(id);
      return transformIssue(response);
    },
    enabled: !!id,
    staleTime: 30000,
  });
}

export function useIssueSummary() {
  return useQuery({
    queryKey: queryKeys.issues.summary,
    queryFn: async () => {
      const response = await fetchIssueSummary();
      return transformIssueSummary(response);
    },
    staleTime: 30000,
  });
}

export function useAcknowledgeIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, acknowledgedBy }: { id: string; acknowledgedBy: string }) =>
      acknowledgeIssue(id, acknowledgedBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.all });
    },
  });
}

export function useResolveIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, resolvedBy }: { id: string; resolvedBy: string }) =>
      resolveIssue(id, resolvedBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.issues.all });
    },
  });
}

// ============ Billing Hooks ============

export function useBillingSummary(filters: BillingFilters = {}) {
  // Get databases to map database names
  const { data: databasesData } = useDatabases({ page_size: 100 });

  return useQuery({
    queryKey: queryKeys.billing.summary(filters),
    queryFn: async () => {
      const response = await fetchBillingSummary(filters);

      // Create database name map
      const databaseNameMap = new Map<string, string>();
      if (databasesData?.databases) {
        databasesData.databases.forEach((db) => {
          databaseNameMap.set(db.id, db.name);
        });
      }

      return transformBillingSummary(response, databaseNameMap);
    },
    staleTime: 60000, // 1 minute - billing data changes less frequently
  });
}

export function useCostAnomalies(acknowledged?: boolean) {
  const { data: databasesData } = useDatabases({ page_size: 100 });

  return useQuery({
    queryKey: [...queryKeys.billing.anomalies, { acknowledged }],
    queryFn: async () => {
      const response = await fetchCostAnomalies({ acknowledged });

      // Create database name map
      const databaseNameMap = new Map<string, string>();
      if (databasesData?.databases) {
        databasesData.databases.forEach((db) => {
          databaseNameMap.set(db.id, db.name);
        });
      }

      return response.map((a) => transformCostAnomaly(a, databaseNameMap.get(a.database_id || '')));
    },
    staleTime: 60000,
  });
}

export function useAcknowledgeCostAnomaly() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, acknowledgedBy }: { id: string; acknowledgedBy: string }) =>
      acknowledgeCostAnomaly(id, acknowledgedBy),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.billing.anomalies });
      queryClient.invalidateQueries({ queryKey: ['billing', 'summary'] });
    },
  });
}

// Helper hook to get database costs (derived from databases)
export function useDatabaseCosts() {
  const { data: databasesData, isLoading, error } = useDatabases({ page_size: 100 });
  const { data: billingSummary } = useBillingSummary();

  const costs = databasesData?.databases && billingSummary
    ? createDatabaseCosts(databasesData.databases, billingSummary)
    : [];

  return { data: costs, isLoading, error };
}

// ============ Metrics Hooks ============

export function useCurrentMetrics(databaseId: string) {
  return useQuery({
    queryKey: queryKeys.metrics.current(databaseId),
    queryFn: () => fetchCurrentMetrics(databaseId),
    enabled: !!databaseId,
    staleTime: 10000, // 10 seconds - metrics update frequently
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });
}

export function useMetricTimeSeries(
  databaseId: string,
  metricName: string,
  timeWindow: string = '24h'
) {
  return useQuery({
    queryKey: queryKeys.metrics.timeSeries(databaseId, metricName, timeWindow),
    queryFn: () => fetchMetricTimeSeries(databaseId, metricName, timeWindow),
    enabled: !!databaseId && !!metricName,
    staleTime: 30000,
  });
}

// ============ Combined Hooks for Pages ============

/**
 * Hook for Overview page - fetches all required data
 */
export function useOverviewData() {
  const databasesQuery = useDatabases({ page_size: 100 });
  const summaryQuery = useDatabaseSummary();
  const issuesSummaryQuery = useIssueSummary();

  const isLoading =
    databasesQuery.isLoading || summaryQuery.isLoading || issuesSummaryQuery.isLoading;
  const error = databasesQuery.error || summaryQuery.error || issuesSummaryQuery.error;

  // Calculate total cost from databases
  const totalCost = databasesQuery.data?.databases.reduce((sum, db) => sum + db.monthlyCost, 0) || 0;

  return {
    databases: databasesQuery.data?.databases || [],
    summary: {
      totalDatabases: summaryQuery.data?.totalDatabases || 0,
      healthyDatabases: summaryQuery.data?.healthyDatabases || 0,
      warningDatabases: summaryQuery.data?.warningDatabases || 0,
      criticalDatabases: summaryQuery.data?.criticalDatabases || 0,
      totalCost,
      activeIssues: issuesSummaryQuery.data?.activeCount || 0,
    },
    isLoading,
    error,
    refetch: () => {
      databasesQuery.refetch();
      summaryQuery.refetch();
      issuesSummaryQuery.refetch();
    },
  };
}

/**
 * Hook for Billing page - fetches billing summary and costs
 */
export function useBillingData() {
  const billingSummaryQuery = useBillingSummary();
  const databaseCostsQuery = useDatabaseCosts();

  const isLoading = billingSummaryQuery.isLoading || databaseCostsQuery.isLoading;
  const error = billingSummaryQuery.error || databaseCostsQuery.error;

  return {
    summary: billingSummaryQuery.data,
    costs: databaseCostsQuery.data || [],
    timeSeries: billingSummaryQuery.data?.timeSeries || [],
    anomalies: billingSummaryQuery.data?.anomalies || [],
    isLoading,
    error,
    refetch: () => {
      billingSummaryQuery.refetch();
    },
  };
}
