/**
 * Hook that returns live dashboard data from the shared DashboardContext.
 *
 * All existing callers (OverviewPage, IssuesPage, DatabasesPage,
 * DatabaseDetailPage, SummarizationPanel) continue to call useDashboard()
 * with no changes — they now get shared context underneath, so:
 *   - Only one fetch fires at a time
 *   - Auto-refresh is centralised in DashboardProvider
 *   - Sidebar badges and page content always match
 */

import { useDashboardContext } from '@/context/DashboardContext';
import type { Database, Issue } from '@/types';

export interface UseDashboardResult {
  clusters:          Database[];
  issues:            Issue[];
  loading:           boolean;
  error:             string | null;
  lastFetched:       Date | null;
  secondsSinceFetch: number;
  refresh:           () => void;
}

export function useDashboard(): UseDashboardResult {
  return useDashboardContext();
}
