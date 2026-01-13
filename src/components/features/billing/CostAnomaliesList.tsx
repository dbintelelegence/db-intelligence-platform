import { AlertTriangle, TrendingUp, DollarSign, ChevronRight } from 'lucide-react';
import { formatCurrency, formatTimeAgo } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { CostAnomaly } from '@/types';

interface CostAnomaliesListProps {
  anomalies: CostAnomaly[];
  onAnomalyClick?: (anomaly: CostAnomaly) => void;
}

export function CostAnomaliesList({ anomalies, onAnomalyClick }: CostAnomaliesListProps) {
  if (anomalies.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center">
        <div className="flex flex-col items-center gap-2">
          <div className="rounded-full bg-green-100 dark:bg-green-950/30 p-3">
            <DollarSign className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
          <h3 className="font-semibold">No Cost Anomalies</h3>
          <p className="text-sm text-muted-foreground">
            All database costs are within expected ranges
          </p>
        </div>
      </div>
    );
  }

  const getAnomalyTypeLabel = (type: string) => {
    switch (type) {
      case 'spike':
        return 'Cost Spike';
      case 'sustained_increase':
        return 'Sustained Increase';
      case 'unexpected_charge':
        return 'Unexpected Charge';
      default:
        return type;
    }
  };

  const getAnomalyTypeColor = (type: string) => {
    switch (type) {
      case 'spike':
        return 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200';
      case 'sustained_increase':
        return 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200';
      case 'unexpected_charge':
        return 'bg-orange-100 dark:bg-orange-900/50 text-orange-800 dark:text-orange-200';
      default:
        return 'bg-gray-100 dark:bg-gray-900/50 text-gray-800 dark:text-gray-200';
    }
  };

  return (
    <div className="space-y-3">
      {anomalies.map((anomaly) => {
        const increase = anomaly.amount - anomaly.baseline;
        const increasePercent = ((increase / anomaly.baseline) * 100).toFixed(0);

        return (
          <button
            key={anomaly.id}
            onClick={() => onAnomalyClick?.(anomaly)}
            className="w-full text-left rounded-lg border bg-card p-6 transition-all hover:shadow-md hover:border-primary"
          >
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className="flex-shrink-0 mt-1">
                <div className="rounded-full bg-red-100 dark:bg-red-950/30 p-2">
                  <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn('px-2 py-1 rounded-full text-xs font-medium', getAnomalyTypeColor(anomaly.type))}>
                        {getAnomalyTypeLabel(anomaly.type)}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {formatTimeAgo(anomaly.detectedAt)}
                      </span>
                    </div>
                    <h3 className="font-semibold text-lg">{anomaly.databaseName}</h3>
                  </div>
                  <ChevronRight className="flex-shrink-0 h-5 w-5 text-muted-foreground" />
                </div>

                {/* Cost Change */}
                <div className="flex items-center gap-4 mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Baseline</p>
                    <p className="text-sm font-medium">{formatCurrency(anomaly.baseline)}</p>
                  </div>
                  <TrendingUp className="h-4 w-4 text-red-500" />
                  <div>
                    <p className="text-xs text-muted-foreground">Current</p>
                    <p className="text-sm font-medium text-red-600 dark:text-red-400">
                      {formatCurrency(anomaly.amount)}
                    </p>
                  </div>
                  <div className="ml-auto">
                    <p className="text-xs text-muted-foreground">Increase</p>
                    <p className="text-sm font-bold text-red-600 dark:text-red-400">
                      +{increasePercent}%
                    </p>
                  </div>
                </div>

                {/* Explanation */}
                <p className="text-sm text-muted-foreground line-clamp-2">
                  {anomaly.explanation}
                </p>

                {/* Possible Causes */}
                {anomaly.possibleCauses.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {anomaly.possibleCauses.slice(0, 3).map((cause, index) => (
                      <span
                        key={index}
                        className="text-xs bg-muted px-2 py-1 rounded-full"
                      >
                        {cause}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
