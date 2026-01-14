import { AlertTriangle, AlertCircle, Info, Database, Clock, Tag, ExternalLink, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/formatters';
import type { Alert } from '@/types';

interface AlertCardProps {
  alert: Alert;
  onMarkAsRead?: (alertId: string) => void;
  onDismiss?: (alertId: string) => void;
}

export function AlertCard({ alert, onMarkAsRead, onDismiss }: AlertCardProps) {
  const getSeverityIcon = () => {
    switch (alert.severity) {
      case 'critical':
        return <AlertCircle className="h-5 w-5" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5" />;
      case 'info':
        return <Info className="h-5 w-5" />;
    }
  };

  const getSeverityColors = () => {
    switch (alert.severity) {
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

  const getTypeLabel = (type: string) => {
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const getStatusBadge = () => {
    if (alert.status === 'unread') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
          Unread
        </span>
      );
    }
    if (alert.status === 'dismissed') {
      return (
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
          Dismissed
        </span>
      );
    }
    return null;
  };

  const colors = getSeverityColors();

  return (
    <div
      className={cn(
        'rounded-lg border p-6 transition-all',
        colors.bg,
        colors.border,
        alert.status === 'unread' && 'shadow-md'
      )}
    >
      <div className="flex items-start gap-4">
        {/* Severity Icon */}
        <div className={cn('flex-shrink-0 mt-1', colors.icon)}>
          {getSeverityIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-semibold text-lg">{alert.title}</h3>
                {getStatusBadge()}
              </div>
              <p className="text-sm text-muted-foreground mb-2">{alert.message}</p>
            </div>
          </div>

          {/* Details */}
          {alert.details && (
            <p className="text-sm text-muted-foreground mb-3 leading-relaxed">
              {alert.details}
            </p>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
            {/* Database */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              <span className="font-medium">{alert.databaseName}</span>
            </div>

            {/* Type */}
            <span className={cn('px-2 py-1 rounded-full font-medium', colors.badge)}>
              {getTypeLabel(alert.type)}
            </span>

            {/* Time */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>{formatTimeAgo(alert.timestamp)}</span>
            </div>

            {/* Source */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Tag className="h-3.5 w-3.5" />
              <span>{alert.source}</span>
            </div>
          </div>

          {/* Tags */}
          {alert.tags && alert.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {alert.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs bg-muted px-2 py-1 rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {alert.actionUrl && alert.actionLabel && (
              <a
                href={alert.actionUrl}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                {alert.actionLabel}
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}

            {alert.status === 'unread' && onMarkAsRead && (
              <button
                onClick={() => onMarkAsRead(alert.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium border rounded-lg hover:bg-muted transition-colors"
              >
                <Check className="h-3.5 w-3.5" />
                Mark as Read
              </button>
            )}

            {alert.status !== 'dismissed' && onDismiss && (
              <button
                onClick={() => onDismiss(alert.id)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
