import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { ScoringExplanationCard } from '@/components/features/settings/ScoringExplanationCard';
import { MetricThresholdsEditor } from '@/components/features/settings/MetricThresholdsEditor';
import { ProfileEditor } from '@/components/features/settings/ProfileEditor';
import { ScoringPreview } from '@/components/features/settings/ScoringPreview';
import { UtilizationCostCard } from '@/components/features/settings/UtilizationCostCard';
import { cn } from '@/lib/utils';
import type { Environment } from '@/types';

const ENV_TABS: { value: Environment; label: string; description: string }[] = [
  { value: 'production', label: 'Production', description: 'Strictest thresholds — penalizes both over- and under-utilization' },
  { value: 'staging', label: 'Staging', description: 'Moderately relaxed — lighter underutilization penalties' },
  { value: 'qa', label: 'QA', description: 'Relaxed utilization, strict on performance metrics' },
  { value: 'development', label: 'Development', description: 'Very lenient — no underutilization penalties, relaxed thresholds' },
];

export function SettingsPage() {
  const { resetAll, isDirty, selectedEnv, setSelectedEnv } = useScoringConfig();

  const currentEnvTab = ENV_TABS.find(t => t.value === selectedEnv)!;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-2">
            Configure health score calculation weights and thresholds per environment
          </p>
        </div>
        {isDirty && (
          <Button variant="outline" onClick={resetAll} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset All to Defaults
          </Button>
        )}
      </div>

      {/* Environment selector */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Environment Profile</h2>
        <div className="flex gap-2">
          {ENV_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSelectedEnv(tab.value)}
              className={cn(
                'px-4 py-2 text-sm font-medium rounded-lg transition-colors',
                selectedEnv === tab.value
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {currentEnvTab.description}
        </p>
      </div>

      <ScoringExplanationCard />
      <UtilizationCostCard />
      <ScoringPreview />
      <ProfileEditor />
      <MetricThresholdsEditor />
    </div>
  );
}
