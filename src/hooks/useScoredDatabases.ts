import { useMemo } from 'react';
import type { Database } from '@/types';
import { recalculateDatabaseHealth } from '@/lib/health-scoring';
import { useScoringConfig } from './useScoringConfig';

/**
 * Hook that applies the current scoring configuration to recalculate
 * health scores for an array of databases.
 * Each database is scored using the config for its own environment.
 */
export function useScoredDatabases(databases: Database[]): Database[] {
  const { envConfigs } = useScoringConfig();

  return useMemo(() => {
    return databases.map(db => {
      const config = envConfigs[db.environment];
      return recalculateDatabaseHealth(db, config);
    });
  }, [databases, envConfigs]);
}
