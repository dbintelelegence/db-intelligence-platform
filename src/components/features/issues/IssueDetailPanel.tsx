import { X, AlertTriangle, AlertCircle, Info, Database, Clock, Activity, FileText, GitCommit } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/formatters';
import type { Issue } from '@/types';

interface IssueDetailPanelProps {
  issue: Issue;
  onClose: () => void;
}

export function IssueDetailPanel({ issue, onClose }: IssueDetailPanelProps) {
  const getSeverityIcon = () => {
    switch (issue.severity) {
      case 'critical':
        return <AlertCircle className="h-6 w-6" />;
      case 'warning':
        return <AlertTriangle className="h-6 w-6" />;
      case 'info':
        return <Info className="h-6 w-6" />;
    }
  };

  const getSeverityColors = () => {
    switch (issue.severity) {
      case 'critical':
        return {
          icon: 'text-red-600 dark:text-red-400',
          badge: 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200',
          border: 'border-red-200 dark:border-red-800',
        };
      case 'warning':
        return {
          icon: 'text-amber-600 dark:text-amber-400',
          badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200',
          border: 'border-amber-200 dark:border-amber-800',
        };
      case 'info':
        return {
          icon: 'text-blue-600 dark:text-blue-400',
          badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200',
          border: 'border-blue-200 dark:border-blue-800',
        };
    }
  };

  const getCategoryLabel = (category: string) => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const colors = getSeverityColors();

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full my-8">
        {/* Header */}
        <div className={cn('flex items-start justify-between gap-4 p-6 border-b-2', colors.border)}>
          <div className="flex items-start gap-4 flex-1">
            <div className={cn('flex-shrink-0 mt-1', colors.icon)}>
              {getSeverityIcon()}
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-2xl font-bold mb-2">{issue.title}</h2>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className={cn('px-3 py-1 rounded-full font-medium', colors.badge)}>
                  {issue.severity.toUpperCase()}
                </span>
                <span className="px-3 py-1 rounded-full bg-muted font-medium">
                  {getCategoryLabel(issue.category)}
                </span>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Database className="h-4 w-4" />
                  <span>{issue.databaseName}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-4 w-4" />
                  <span>{formatTimeAgo(issue.detectedAt)}</span>
                </div>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Description */}
          <div>
            <h3 className="font-semibold text-lg mb-2">Description</h3>
            <p className="text-muted-foreground">{issue.description}</p>
          </div>

          {/* Explanation */}
          <div>
            <h3 className="font-semibold text-lg mb-2">Detailed Explanation</h3>
            <p className="text-muted-foreground leading-relaxed">{issue.explanation}</p>
          </div>

          {/* Recommendation */}
          <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
              <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              Recommended Actions
            </h3>
            <p className="text-muted-foreground leading-relaxed">{issue.recommendation}</p>
          </div>

          {/* Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-muted/30 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">First Seen</p>
              <p className="font-medium">{formatTimeAgo(issue.firstSeen)}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">Last Seen</p>
              <p className="font-medium">{formatTimeAgo(issue.lastSeen)}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">Occurrences</p>
              <p className="font-medium">{issue.occurrences}x</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">Status</p>
              <p className="font-medium capitalize">{issue.status}</p>
            </div>
          </div>

          {/* Related Metrics */}
          {issue.relatedMetrics.length > 0 && (
            <div>
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <Activity className="h-5 w-5" />
                Related Metrics
              </h3>
              <div className="flex flex-wrap gap-2">
                {issue.relatedMetrics.map((metric) => (
                  <span
                    key={metric}
                    className="px-3 py-1 bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-200 rounded-full text-sm font-medium"
                  >
                    {metric}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Related Logs */}
          {issue.relatedLogs.length > 0 && (
            <div>
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Related Logs
              </h3>
              <div className="space-y-2">
                {issue.relatedLogs.slice(0, 5).map((log, index) => (
                  <div
                    key={index}
                    className="bg-muted/30 rounded-lg p-3 font-mono text-xs border"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        'px-2 py-0.5 rounded font-semibold text-[10px] uppercase',
                        log.level === 'error' && 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200',
                        log.level === 'warn' && 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200',
                        log.level === 'info' && 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200',
                        log.level === 'debug' && 'bg-gray-100 dark:bg-gray-900/50 text-gray-800 dark:text-gray-200'
                      )}>
                        {log.level}
                      </span>
                      <span className="text-muted-foreground">{log.source}</span>
                      <span className="text-muted-foreground ml-auto">{formatTimeAgo(log.timestamp)}</span>
                    </div>
                    <p className="text-foreground">{log.message}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Related Changes */}
          {issue.relatedChanges.length > 0 && (
            <div>
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <GitCommit className="h-5 w-5" />
                Related Changes
              </h3>
              <div className="space-y-3">
                {issue.relatedChanges.map((change, index) => (
                  <div key={index} className="flex gap-3">
                    <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-2"></div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-muted rounded text-xs font-medium capitalize">
                          {change.type.replace('_', ' ')}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatTimeAgo(change.timestamp)}</span>
                      </div>
                      <p className="text-sm">{change.description}</p>
                      {change.author && (
                        <p className="text-xs text-muted-foreground mt-1">by {change.author}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
