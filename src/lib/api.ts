/**
 * Thin API client for the DB Intelligence Platform backend.
 * All fetch calls go through here — no fetch() calls scattered in components.
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    throw new Error(`API ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface DashboardSummary {
  clusters: import('@/types').Database[];
  issues:   import('@/types').Issue[];
}

export interface TrendPoint { ts: string; value: number; }
export interface TrendSeries { instance_id: string | null; points: TrendPoint[]; }
export interface VerdictTrend {
  series: TrendSeries[];
  baseline: { p50: number; p95: number } | null;
  unit: string;
  metric_name: string;
  issue_started_at: string | null;
  points_collected: number;
}

export const api = {
  dashboard: {
    summary: (): Promise<DashboardSummary> => get('/dashboard/summary'),
  },
  verdicts: {
    trend: (clusterId: string, analyzerName: string, hours = 24): Promise<VerdictTrend> =>
      get(`/verdicts/${clusterId}/${analyzerName}/trend?hours=${hours}`),
  },
};
