/**
 * Hook that fetches live dashboard data from the backend.
 * Falls back to mock data while loading or on error so the UI
 * is never blank during development.
 */

import { useState, useEffect, useCallback } from 'react';
import { api, type DashboardSummary } from '@/lib/api';
import { mockData } from '@/data/mock-data';
import type { Database, Issue } from '@/types';

interface UseDashboardResult {
  clusters:   Database[];
  issues:     Issue[];
  loading:    boolean;
  error:      string | null;
  lastFetched: Date | null;
  refresh:    () => void;
}

export function useDashboard(): UseDashboardResult {
  const [data, setData]           = useState<DashboardSummary | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [tick, setTick]           = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.dashboard.summary()
      .then(result => {
        if (!cancelled) {
          setData(result);
          setLastFetched(new Date());
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message ?? 'Failed to load dashboard data');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [tick]);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  // On error only (not during loading), fall back to mock data so dev/offline
  // workflows still show something useful. During loading, return empty arrays
  // so pages can show a skeleton instead of a mock-data flash.
  const useMock = !loading && !!error && !data;
  return {
    clusters:    data?.clusters ?? (useMock ? (mockData.databases as Database[]) : []),
    issues:      data?.issues   ?? (useMock ? (mockData.issues   as Issue[])   : []),
    loading,
    error,
    lastFetched,
    refresh,
  };
}
