import { createContext, useContext } from 'react';
import type { ScoringConfiguration, EnvironmentScoringConfigurations, DatabaseType, Environment } from '@/types';

export interface ScoringConfigContextValue {
  /** Full environment-keyed configurations */
  envConfigs: EnvironmentScoringConfigurations;
  /** Currently selected environment in settings UI */
  selectedEnv: Environment;
  setSelectedEnv: (env: Environment) => void;
  /** Convenience: the config for the selected environment */
  config: ScoringConfiguration;
  /** Get config for a specific environment */
  getConfigForEnv: (env: Environment) => ScoringConfiguration;
  updateProfile: (dbType: DatabaseType, weights: Record<string, number>) => void;
  updateThresholds: (thresholds: ScoringConfiguration['metricThresholds']) => void;
  updateConfig: (config: ScoringConfiguration) => void;
  resetAll: () => void;
  resetProfile: (dbType: DatabaseType) => void;
  resetThresholds: () => void;
  isDirty: boolean;
}

export const ScoringConfigContext = createContext<ScoringConfigContextValue | undefined>(undefined);

export function useScoringConfig(): ScoringConfigContextValue {
  const context = useContext(ScoringConfigContext);
  if (context === undefined) {
    throw new Error('useScoringConfig must be used within a ScoringConfigProvider');
  }
  return context;
}
