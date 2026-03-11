import { useState, useCallback, useEffect } from 'react';
import type { ScoringConfiguration, EnvironmentScoringConfigurations, DatabaseType, Environment, ScoringMetric } from '@/types';
import {
  loadEnvScoringConfigurations,
  saveEnvScoringConfigurations,
  resetEnvScoringConfigurations,
  resetEnvProfileToDefault,
  resetEnvThresholdsToDefault,
  DEFAULT_ENV_SCORING_CONFIGURATIONS,
} from '@/constants/health-scoring-defaults';
import { ScoringConfigContext } from '@/hooks/useScoringConfig';

interface ScoringConfigProviderProps {
  children: React.ReactNode;
}

export function ScoringConfigProvider({ children }: ScoringConfigProviderProps) {
  const [envConfigs, setEnvConfigs] = useState<EnvironmentScoringConfigurations>(() => loadEnvScoringConfigurations());
  const [selectedEnv, setSelectedEnv] = useState<Environment>('production');
  const [isDirty, setIsDirty] = useState(false);

  // Auto-save when configs change
  useEffect(() => {
    if (isDirty) {
      saveEnvScoringConfigurations(envConfigs);
    }
  }, [envConfigs, isDirty]);

  const config = envConfigs[selectedEnv];

  const getConfigForEnv = useCallback((env: Environment) => envConfigs[env], [envConfigs]);

  const updateProfile = useCallback((dbType: DatabaseType, weights: Record<string, number>) => {
    setEnvConfigs(prev => ({
      ...prev,
      [selectedEnv]: {
        ...prev[selectedEnv],
        profiles: prev[selectedEnv].profiles.map(p =>
          p.dbType === dbType
            ? { ...p, weights: weights as Record<ScoringMetric, number> }
            : p
        ),
      },
    }));
    setIsDirty(true);
  }, [selectedEnv]);

  const updateThresholds = useCallback((thresholds: ScoringConfiguration['metricThresholds']) => {
    setEnvConfigs(prev => ({
      ...prev,
      [selectedEnv]: {
        ...prev[selectedEnv],
        metricThresholds: thresholds,
      },
    }));
    setIsDirty(true);
  }, [selectedEnv]);

  const updateConfig = useCallback((newConfig: ScoringConfiguration) => {
    setEnvConfigs(prev => ({
      ...prev,
      [selectedEnv]: newConfig,
    }));
    setIsDirty(true);
  }, [selectedEnv]);

  const resetAll = useCallback(() => {
    const defaults = resetEnvScoringConfigurations();
    setEnvConfigs(defaults);
    setIsDirty(false);
  }, []);

  const resetProfile = useCallback((dbType: DatabaseType) => {
    setEnvConfigs(prev => resetEnvProfileToDefault(selectedEnv, dbType, prev));
    setIsDirty(true);
  }, [selectedEnv]);

  const resetThresholds = useCallback(() => {
    setEnvConfigs(prev => resetEnvThresholdsToDefault(selectedEnv, prev));
    setIsDirty(true);
  }, [selectedEnv]);

  const computedIsDirty = isDirty || JSON.stringify(envConfigs) !== JSON.stringify(DEFAULT_ENV_SCORING_CONFIGURATIONS);

  return (
    <ScoringConfigContext.Provider
      value={{
        envConfigs,
        selectedEnv,
        setSelectedEnv,
        config,
        getConfigForEnv,
        updateProfile,
        updateThresholds,
        updateConfig,
        resetAll,
        resetProfile,
        resetThresholds,
        isDirty: computedIsDirty,
      }}
    >
      {children}
    </ScoringConfigContext.Provider>
  );
}
