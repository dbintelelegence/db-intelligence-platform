/**
 * DashboardContext — single source of truth for live dashboard data.
 *
 * One fetch, one 30-second auto-refresh timer, shared across the entire app.
 * All components read from this context so sidebar badges and page content
 * always show the same numbers.
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { api, type DashboardSummary } from '@/lib/api';
import { mockData } from '@/data/mock-data';
import type { Database, Issue } from '@/types';

const AUTO_REFRESH_MS = 30_000;

interface DashboardContextValue {
  clusters:          Database[];
  issues:            Issue[];
  loading:           boolean;
  error:             string | null;
  lastFetched:       Date | null;
  secondsSinceFetch: number;
  refresh:           () => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const [data, setData]               = useState<DashboardSummary | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [secondsSinceFetch, setSecondsSinceFetch] = useState(0);
  const [tick, setTick]               = useState(0);
  const counterRef                    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch on mount and whenever tick bumps (manual refresh or auto-refresh)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api.dashboard.summary()
      .then(result => {
        if (!cancelled) {
          setData(result);
          setLastFetched(new Date());
          setSecondsSinceFetch(0);
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

  // Auto-refresh every 30 seconds
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // Live "X seconds ago" counter — resets each time lastFetched changes
  useEffect(() => {
    if (counterRef.current) clearInterval(counterRef.current);
    setSecondsSinceFetch(0);
    counterRef.current = setInterval(() => {
      setSecondsSinceFetch(s => s + 1);
    }, 1000);
    return () => {
      if (counterRef.current) clearInterval(counterRef.current);
    };
  }, [lastFetched]);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  const useMock = !loading && !!error && !data;

  return (
    <DashboardContext.Provider value={{
      clusters:          data?.clusters ?? (useMock ? (mockData.databases as Database[]) : []),
      issues:            data?.issues   ?? (useMock ? (mockData.issues   as Issue[])   : []),
      loading,
      error,
      lastFetched,
      secondsSinceFetch,
      refresh,
    }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboardContext(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboardContext must be used inside DashboardProvider');
  return ctx;
}
