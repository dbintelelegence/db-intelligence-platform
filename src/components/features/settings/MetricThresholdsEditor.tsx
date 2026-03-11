import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { useScoringConfig } from '@/hooks/useScoringConfig';
import type { MetricThresholdConfig } from '@/types';

export function MetricThresholdsEditor() {
  const { config, updateThresholds, resetThresholds } = useScoringConfig();

  const handleBandChange = (
    metricIndex: number,
    bandIndex: number,
    field: 'upperBound' | 'subScore',
    value: string
  ) => {
    const newThresholds = config.metricThresholds.map((t, i) => {
      if (i !== metricIndex) return t;
      return {
        ...t,
        bands: t.bands.map((b, j) => {
          if (j !== bandIndex) return b;
          const numValue = parseFloat(value);
          if (isNaN(numValue)) return b;
          return { ...b, [field]: numValue };
        }),
      };
    });
    updateThresholds(newThresholds);
  };

  const handleUnderutilBandChange = (
    metricIndex: number,
    bandIndex: number,
    field: 'upperBound' | 'subScore',
    value: string
  ) => {
    const newThresholds = config.metricThresholds.map((t, i) => {
      if (i !== metricIndex || !t.underutilizationBands) return t;
      return {
        ...t,
        underutilizationBands: t.underutilizationBands.map((b, j) => {
          if (j !== bandIndex) return b;
          const numValue = parseFloat(value);
          if (isNaN(numValue)) return b;
          return { ...b, [field]: numValue };
        }),
      };
    });
    updateThresholds(newThresholds);
  };

  const getDirectionLabel = (threshold: MetricThresholdConfig) => {
    if (threshold.underutilizationBands?.length) return 'Optimal range';
    return threshold.direction === 'lower_better' ? 'Lower is better' : 'Higher is better';
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Metric Threshold Bands</CardTitle>
        <Button variant="outline" size="sm" onClick={resetThresholds} className="gap-2">
          <RotateCcw className="h-4 w-4" />
          Reset Thresholds
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {config.metricThresholds.map((threshold, metricIndex) => (
            <div key={threshold.metric} className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">
                  {threshold.displayName}
                  <span className="text-muted-foreground font-normal ml-2">({threshold.unit})</span>
                </h4>
                <span className="text-xs text-muted-foreground">
                  {getDirectionLabel(threshold)}
                </span>
              </div>

              {/* Underutilization bands (if any) */}
              {threshold.underutilizationBands && threshold.underutilizationBands.length > 0 && (
                <div className="space-y-1">
                  <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Underutilization</span>
                  <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${threshold.underutilizationBands.length}, minmax(0, 1fr))` }}>
                    {threshold.underutilizationBands.map((band, bandIndex) => (
                      <div key={bandIndex} className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-2">
                        <div className="text-xs font-medium text-center text-amber-600 dark:text-amber-400">
                          {band.label}
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Below</label>
                          <input
                            type="number"
                            value={band.upperBound}
                            onChange={(e) => handleUnderutilBandChange(metricIndex, bandIndex, 'upperBound', e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center"
                            step={5}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Sub-Score</label>
                          <input
                            type="number"
                            value={band.subScore}
                            onChange={(e) => handleUnderutilBandChange(metricIndex, bandIndex, 'subScore', e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center"
                            min={0} max={100} step={5}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Normal (overutilization) bands */}
              <div className="space-y-1">
                {threshold.underutilizationBands && threshold.underutilizationBands.length > 0 && (
                  <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Overutilization</span>
                )}
                <div className="grid grid-cols-4 gap-2">
                  {threshold.bands.map((band, bandIndex) => {
                    const isLastBand = bandIndex === threshold.bands.length - 1;
                    const isInfinity = band.upperBound === Infinity;
                    const boundLabel = threshold.direction === 'lower_better'
                      ? (isInfinity ? `> ${threshold.bands[bandIndex - 1]?.upperBound ?? ''}` : `\u2264 ${band.upperBound}`)
                      : (bandIndex === 0 ? `\u2265 ${band.upperBound}` : `\u2265 ${band.upperBound}`);

                    return (
                      <div key={bandIndex} className="rounded-lg border p-3 space-y-2">
                        <div className="text-xs font-medium text-center">
                          <span
                            className={
                              band.subScore >= 90 ? 'text-emerald-600' :
                              band.subScore >= 70 ? 'text-green-500' :
                              band.subScore >= 40 ? 'text-amber-500' :
                              'text-red-500'
                            }
                          >
                            {band.label}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">
                            {threshold.direction === 'lower_better' ? 'Upper Bound' : 'Min Value'}
                          </label>
                          {isLastBand && threshold.direction === 'lower_better' ? (
                            <div className="text-xs text-center text-muted-foreground py-1.5">
                              {boundLabel}
                            </div>
                          ) : (
                            <input
                              type="number"
                              value={band.upperBound}
                              onChange={(e) => handleBandChange(metricIndex, bandIndex, 'upperBound', e.target.value)}
                              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center"
                              step={threshold.unit === 'ms' ? 5 : threshold.unit === 'qps' ? 50 : 5}
                            />
                          )}
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Sub-Score</label>
                          <input
                            type="number"
                            value={band.subScore}
                            onChange={(e) => handleBandChange(metricIndex, bandIndex, 'subScore', e.target.value)}
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-center"
                            min={0} max={100} step={5}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
