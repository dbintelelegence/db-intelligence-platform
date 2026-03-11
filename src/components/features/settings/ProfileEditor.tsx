import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RotateCcw, Scale } from 'lucide-react';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import { validateWeights } from '@/lib/health-scoring';
import { cn } from '@/lib/utils';
import type { DatabaseType, ScoringMetric } from '@/types';

const METRIC_LABELS: Record<ScoringMetric, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  storage: 'Storage',
  connectionRatio: 'Connections',
  latency: 'Latency',
  throughput: 'Throughput',
};

const ALL_METRICS: ScoringMetric[] = ['cpu', 'memory', 'storage', 'connectionRatio', 'latency', 'throughput'];

export function ProfileEditor() {
  const { config, updateProfile, resetProfile } = useScoringConfig();
  const [selectedDbType, setSelectedDbType] = useState<DatabaseType>(config.profiles[0]?.dbType ?? 'postgres');

  const currentProfile = config.profiles.find(p => p.dbType === selectedDbType);
  if (!currentProfile) return null;

  const { valid, sum } = validateWeights(currentProfile.weights);

  const handleWeightChange = (metric: ScoringMetric, value: number) => {
    const newWeights = { ...currentProfile.weights, [metric]: value };
    updateProfile(selectedDbType, newWeights);
  };

  const autoNormalize = () => {
    const currentSum = Object.values(currentProfile.weights).reduce((a, b) => a + b, 0);
    if (currentSum === 0) return;

    const normalized: Record<string, number> = {};
    for (const [metric, weight] of Object.entries(currentProfile.weights)) {
      normalized[metric] = Math.round((weight / currentSum) * 100) / 100;
    }

    // Fix rounding to ensure sum is exactly 1.0
    const normalizedSum = Object.values(normalized).reduce((a, b) => a + b, 0);
    const diff = 1.0 - normalizedSum;
    if (diff !== 0) {
      // Add the diff to the largest weight
      const maxMetric = Object.entries(normalized).reduce((a, b) => a[1] > b[1] ? a : b)[0];
      normalized[maxMetric] = Math.round((normalized[maxMetric] + diff) * 100) / 100;
    }

    updateProfile(selectedDbType, normalized);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Database Type Weight Profiles</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Tab selector for database types */}
        <div className="flex flex-wrap gap-2">
          {config.profiles.map((profile) => (
            <button
              key={profile.dbType}
              onClick={() => setSelectedDbType(profile.dbType)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg transition-colors',
                selectedDbType === profile.dbType
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {profile.displayName}
            </button>
          ))}
        </div>

        {/* Profile description */}
        <p className="text-sm text-muted-foreground">{currentProfile.description}</p>

        {/* Weight sum indicator */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Weight Sum:</span>
            <span
              className={cn(
                'text-sm font-bold px-2 py-0.5 rounded',
                valid
                  ? 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20'
                  : 'text-red-600 bg-red-50 dark:bg-red-900/20'
              )}
            >
              {sum.toFixed(2)}
            </span>
            {!valid && (
              <span className="text-xs text-red-500">Must equal 1.00</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={autoNormalize} className="gap-2">
              <Scale className="h-4 w-4" />
              Auto-normalize
            </Button>
            <Button variant="outline" size="sm" onClick={() => resetProfile(selectedDbType)} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Reset Profile
            </Button>
          </div>
        </div>

        {/* Weight sliders */}
        <div className="space-y-4">
          {ALL_METRICS.map((metric) => {
            const weight = currentProfile.weights[metric];
            return (
              <div key={metric} className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">{METRIC_LABELS[metric]}</label>
                  <span className="text-sm tabular-nums text-muted-foreground w-12 text-right">
                    {weight.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weight}
                  onChange={(e) => handleWeightChange(metric, parseFloat(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            );
          })}
        </div>

        {/* Type-specific custom metric */}
        {currentProfile.customMetric && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-400">
                Type-Specific: {currentProfile.customMetric.displayName}
              </h4>
              <span className="text-xs text-muted-foreground">
                Weight: {currentProfile.customMetric.weight.toFixed(2)} · {currentProfile.customMetric.unit} · {currentProfile.customMetric.direction === 'lower_better' ? 'Lower is better' : 'Higher is better'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              This metric is unique to {currentProfile.displayName} and contributes {(currentProfile.customMetric.weight * 100).toFixed(0)}% to the health score.
              The standard 6 metric weights are proportionally scaled to fill the remaining {((1 - currentProfile.customMetric.weight) * 100).toFixed(0)}%.
            </p>
            <div className="grid grid-cols-4 gap-2">
              {currentProfile.customMetric.bands.map((band, i) => (
                <div key={i} className="rounded border bg-background p-2 text-center space-y-1">
                  <span className={cn(
                    'text-xs font-medium',
                    band.subScore >= 90 ? 'text-emerald-600' :
                    band.subScore >= 70 ? 'text-green-500' :
                    band.subScore >= 40 ? 'text-amber-500' :
                    'text-red-500'
                  )}>
                    {band.label}
                  </span>
                  <div className="text-xs text-muted-foreground">
                    {currentProfile.customMetric!.direction === 'lower_better'
                      ? (band.upperBound === Infinity ? `> ${currentProfile.customMetric!.bands[i - 1]?.upperBound ?? ''}` : `≤ ${band.upperBound}`)
                      : `≥ ${band.upperBound}`
                    }
                    {' '}{currentProfile.customMetric!.unit}
                  </div>
                  <div className="text-xs font-semibold">Score: {band.subScore}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
