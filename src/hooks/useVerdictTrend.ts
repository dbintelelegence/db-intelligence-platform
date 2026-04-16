import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { VerdictTrend } from '@/lib/api';

export function useVerdictTrend(clusterId: string, analyzerName: string) {
  const [data, setData] = useState<VerdictTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.verdicts.trend(clusterId, analyzerName)
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError('failed'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [clusterId, analyzerName]);

  return { data, loading, error };
}
