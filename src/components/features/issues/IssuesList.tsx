import { IssueCard } from './IssueCard';
import type { Issue } from '@/types';

interface IssuesListProps {
  issues: Issue[];
  onIssueClick: (issue: Issue) => void;
}

export function IssuesList({ issues, onIssueClick }: IssuesListProps) {
  if (issues.length === 0) {
    return (
      <div className="text-center py-12 bg-muted/30 rounded-lg border border-dashed">
        <p className="text-muted-foreground text-lg">No issues found</p>
        <p className="text-muted-foreground text-sm mt-1">
          Try adjusting your filters or search query
        </p>
      </div>
    );
  }

  // Group issues by severity
  const criticalIssues = issues.filter((issue) => issue.severity === 'critical');
  const warningIssues = issues.filter((issue) => issue.severity === 'warning');
  const infoIssues = issues.filter((issue) => issue.severity === 'info');

  return (
    <div className="space-y-8">
      {/* Critical Issues */}
      {criticalIssues.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300 text-sm font-bold">
              {criticalIssues.length}
            </span>
            Critical Issues
          </h2>
          <div className="space-y-3">
            {criticalIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} onClick={() => onIssueClick(issue)} />
            ))}
          </div>
        </div>
      )}

      {/* Warning Issues */}
      {warningIssues.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-sm font-bold">
              {warningIssues.length}
            </span>
            Warning Issues
          </h2>
          <div className="space-y-3">
            {warningIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} onClick={() => onIssueClick(issue)} />
            ))}
          </div>
        </div>
      )}

      {/* Info Issues */}
      {infoIssues.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 text-sm font-bold">
              {infoIssues.length}
            </span>
            Info Issues
          </h2>
          <div className="space-y-3">
            {infoIssues.map((issue) => (
              <IssueCard key={issue.id} issue={issue} onClick={() => onIssueClick(issue)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
