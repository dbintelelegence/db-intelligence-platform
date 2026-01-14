import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getIssuesByDatabaseId } from '@/data/mock-data';
import { IssueCard } from '@/components/features/issues/IssueCard';
import { ExternalLink } from 'lucide-react';
import type { TimeRange } from '@/hooks/useTimeRange';
import type { IssueSeverity, IssueCategory } from '@/types';

interface IssuesTabProps {
  databaseId: string;
  timeRange: TimeRange;
}

export function IssuesTab({ databaseId, timeRange }: IssuesTabProps) {
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | 'all'>('all');

  const issues = useMemo(() => {
    let filtered = getIssuesByDatabaseId(databaseId);

    // Filter by time range
    filtered = filtered.filter(
      (issue) => issue.detectedAt >= timeRange.start && issue.detectedAt <= timeRange.end
    );

    // Filter by severity
    if (severityFilter !== 'all') {
      filtered = filtered.filter((issue) => issue.severity === severityFilter);
    }

    // Filter by category
    if (categoryFilter !== 'all') {
      filtered = filtered.filter((issue) => issue.category === categoryFilter);
    }

    // Sort by severity (critical first) then by time (newest first)
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    filtered.sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.detectedAt.getTime() - a.detectedAt.getTime();
    });

    return filtered;
  }, [databaseId, timeRange, severityFilter, categoryFilter]);

  const criticalCount = issues.filter((i) => i.severity === 'critical').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const infoCount = issues.filter((i) => i.severity === 'info').length;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <div className="flex flex-col sm:flex-row gap-3 flex-1">
            <div className="w-full sm:w-auto">
              <Select value={severityFilter} onValueChange={(value) => setSeverityFilter(value as IssueSeverity | 'all')}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All Severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severities</SelectItem>
                  <SelectItem value="critical">Critical ({criticalCount})</SelectItem>
                  <SelectItem value="warning">Warning ({warningCount})</SelectItem>
                  <SelectItem value="info">Info ({infoCount})</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-auto">
              <Select value={categoryFilter} onValueChange={(value) => setCategoryFilter(value as IssueCategory | 'all')}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="performance">Performance</SelectItem>
                  <SelectItem value="capacity">Capacity</SelectItem>
                  <SelectItem value="availability">Availability</SelectItem>
                  <SelectItem value="security">Security</SelectItem>
                  <SelectItem value="configuration">Configuration</SelectItem>
                  <SelectItem value="cost">Cost</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Link
            to={`/issues?database=${databaseId}`}
            className="text-sm text-primary hover:underline flex items-center gap-1 whitespace-nowrap"
          >
            View all issues
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </Card>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Critical</span>
            <span className="text-2xl font-bold text-red-600 dark:text-red-400">{criticalCount}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Warning</span>
            <span className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{warningCount}</span>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Info</span>
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{infoCount}</span>
          </div>
        </Card>
      </div>

      {/* Issues List */}
      {issues.length > 0 ? (
        <div className="space-y-3">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} onClick={() => {}} />
          ))}
        </div>
      ) : (
        <Card className="p-12">
          <div className="text-center">
            <p className="text-muted-foreground">
              {severityFilter !== 'all' || categoryFilter !== 'all'
                ? 'No issues match the selected filters'
                : 'No issues found in the selected time range'}
            </p>
            {(severityFilter !== 'all' || categoryFilter !== 'all') && (
              <button
                onClick={() => {
                  setSeverityFilter('all');
                  setCategoryFilter('all');
                }}
                className="text-sm text-primary hover:underline mt-2"
              >
                Clear filters
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
