import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IssueSeverity } from '@/types';

interface IssuesSummaryProps {
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  onSeverityClick: (severity: IssueSeverity) => void;
}

export function IssuesSummary({
  criticalCount,
  warningCount,
  infoCount,
  onSeverityClick,
}: IssuesSummaryProps) {
  const summaryCards = [
    {
      severity: 'critical' as IssueSeverity,
      label: 'Critical Issues',
      count: criticalCount,
      icon: AlertCircle,
      bgColor: 'bg-red-50 dark:bg-red-950/30',
      borderColor: 'border-red-200 dark:border-red-800',
      iconColor: 'text-red-600 dark:text-red-400',
      textColor: 'text-red-900 dark:text-red-100',
      hoverColor: 'hover:bg-red-100 dark:hover:bg-red-900/40',
    },
    {
      severity: 'warning' as IssueSeverity,
      label: 'Warning Issues',
      count: warningCount,
      icon: AlertTriangle,
      bgColor: 'bg-amber-50 dark:bg-amber-950/30',
      borderColor: 'border-amber-200 dark:border-amber-800',
      iconColor: 'text-amber-600 dark:text-amber-400',
      textColor: 'text-amber-900 dark:text-amber-100',
      hoverColor: 'hover:bg-amber-100 dark:hover:bg-amber-900/40',
    },
    {
      severity: 'info' as IssueSeverity,
      label: 'Info Issues',
      count: infoCount,
      icon: Info,
      bgColor: 'bg-blue-50 dark:bg-blue-950/30',
      borderColor: 'border-blue-200 dark:border-blue-800',
      iconColor: 'text-blue-600 dark:text-blue-400',
      textColor: 'text-blue-900 dark:text-blue-100',
      hoverColor: 'hover:bg-blue-100 dark:hover:bg-blue-900/40',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {summaryCards.map((card) => {
        const Icon = card.icon;
        return (
          <button
            key={card.severity}
            onClick={() => onSeverityClick(card.severity)}
            className={cn(
              'flex items-center gap-4 p-6 rounded-lg border-2 transition-all cursor-pointer text-left',
              card.bgColor,
              card.borderColor,
              card.hoverColor
            )}
          >
            <div className={cn('flex-shrink-0', card.iconColor)}>
              <Icon className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
              <p className={cn('text-3xl font-bold mt-1', card.textColor)}>{card.count}</p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
