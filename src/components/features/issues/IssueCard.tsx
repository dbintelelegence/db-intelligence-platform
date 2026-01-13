import { AlertTriangle, AlertCircle, Info, Database, ChevronRight, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/formatters';
import type { Issue } from '@/types';

interface IssueCardProps {
  issue: Issue;
  onClick: () => void;
}

export function IssueCard({ issue, onClick }: IssueCardProps) {
  const getSeverityIcon = () => {
    switch (issue.severity) {
      case 'critical':
        return <AlertCircle className="h-5 w-5" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5" />;
      case 'info':
        return <Info className="h-5 w-5" />;
    }
  };

  const getSeverityColors = () => {
    switch (issue.severity) {
      case 'critical':
        return {
          bg: 'bg-red-50 dark:bg-red-950/30',
          border: 'border-red-200 dark:border-red-800',
          icon: 'text-red-600 dark:text-red-400',
          badge: 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200',
        };
      case 'warning':
        return {
          bg: 'bg-amber-50 dark:bg-amber-950/30',
          border: 'border-amber-200 dark:border-amber-800',
          icon: 'text-amber-600 dark:text-amber-400',
          badge: 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200',
        };
      case 'info':
        return {
          bg: 'bg-blue-50 dark:bg-blue-950/30',
          border: 'border-blue-200 dark:border-blue-800',
          icon: 'text-blue-600 dark:text-blue-400',
          badge: 'bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200',
        };
    }
  };

  const getCategoryLabel = (category: string) => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const colors = getSeverityColors();

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-6 rounded-lg border transition-all hover:shadow-md',
        colors.bg,
        colors.border
      )}
    >
      <div className="flex items-start gap-4">
        {/* Severity Icon */}
        <div className={cn('flex-shrink-0 mt-1', colors.icon)}>
          {getSeverityIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title and Status */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <h3 className="font-semibold text-lg leading-tight">{issue.title}</h3>
            <ChevronRight className="flex-shrink-0 h-5 w-5 text-muted-foreground mt-1" />
          </div>

          {/* Description */}
          <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{issue.description}</p>

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {/* Database */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              <span className="font-medium">{issue.databaseName}</span>
            </div>

            {/* Category */}
            <span className={cn('px-2 py-1 rounded-full font-medium', colors.badge)}>
              {getCategoryLabel(issue.category)}
            </span>

            {/* Time */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatTimeAgo(issue.detectedAt)}</span>
            </div>

            {/* Occurrences */}
            {issue.occurrences > 1 && (
              <span className="text-muted-foreground">
                {issue.occurrences}x occurrences
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
