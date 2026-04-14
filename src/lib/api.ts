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

export const api = {
  dashboard: {
    summary: (): Promise<DashboardSummary> => get('/dashboard/summary'),
  },
};
