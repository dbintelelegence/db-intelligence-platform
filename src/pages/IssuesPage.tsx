import { useState, useMemo } from 'react';
import { IssuesFilters } from '@/components/features/issues/IssuesFilters';
import { IssuesSummary } from '@/components/features/issues/IssuesSummary';
import { IssuesList } from '@/components/features/issues/IssuesList';
import { IssueDetailPanel } from '@/components/features/issues/IssueDetailPanel';
import { useIssues, useIssueSummary } from '@/hooks/useApi';
import type { Issue, IssueSeverity, IssueCategory } from '@/types';
import { Loader2 } from 'lucide-react';

export function IssuesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | 'all'>('all');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  // Fetch issues from API with server-side filtering
  const { data: issuesData, isLoading: issuesLoading, error: issuesError } = useIssues({
    severity: severityFilter !== 'all' ? severityFilter : undefined,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    page_size: 100,
  });

  // Fetch issue summary for counts
  const { data: summaryData, isLoading: summaryLoading } = useIssueSummary();

  const isLoading = issuesLoading || summaryLoading;

  // Client-side search filtering (API doesn't support text search on issues)
  const filteredIssues = useMemo(() => {
    let issues = issuesData?.issues || [];

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      issues = issues.filter(
        (issue) =>
          issue.title.toLowerCase().includes(query) ||
          issue.description.toLowerCase().includes(query) ||
          issue.databaseName.toLowerCase().includes(query)
      );
    }

    return issues;
  }, [issuesData?.issues, searchQuery]);

  // Use summary data for counts, or calculate from filtered if not available
  const counts = useMemo(() => {
    if (summaryData) {
      return {
        critical: summaryData.criticalCount,
        warning: summaryData.warningCount,
        info: summaryData.infoCount,
      };
    }
    return {
      critical: filteredIssues.filter((issue) => issue.severity === 'critical').length,
      warning: filteredIssues.filter((issue) => issue.severity === 'warning').length,
      info: filteredIssues.filter((issue) => issue.severity === 'info').length,
    };
  }, [summaryData, filteredIssues]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setSeverityFilter('all');
    setCategoryFilter('all');
  };

  const handleSeverityClick = (severity: IssueSeverity) => {
    setSeverityFilter(severityFilter === severity ? 'all' : severity);
  };

  const hasActiveFilters = searchQuery !== '' || severityFilter !== 'all' || categoryFilter !== 'all';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading issues...</span>
      </div>
    );
  }

  if (issuesError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
        <h2 className="text-lg font-semibold text-destructive">Error loading issues</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Unable to connect to the backend API. Make sure the server is running.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Error: {issuesError instanceof Error ? issuesError.message : 'Unknown error'}
        </p>
      </div>
    );
  }

  const totalIssues = issuesData?.total || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Issues & Anomalies</h1>
        <p className="text-muted-foreground mt-1">
          Monitor and resolve database issues across your entire fleet
        </p>
      </div>

      {/* Summary Cards */}
      <IssuesSummary
        criticalCount={counts.critical}
        warningCount={counts.warning}
        infoCount={counts.info}
        onSeverityClick={handleSeverityClick}
      />

      {/* Filters */}
      <IssuesFilters
        searchQuery={searchQuery}
        severityFilter={severityFilter}
        categoryFilter={categoryFilter}
        onSearchChange={setSearchQuery}
        onSeverityChange={setSeverityFilter}
        onCategoryChange={setCategoryFilter}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Results Count */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Showing {filteredIssues.length} of {totalIssues} issues
        </p>
      </div>

      {/* Issues List */}
      <IssuesList issues={filteredIssues} onIssueClick={setSelectedIssue} />

      {/* Issue Detail Panel */}
      {selectedIssue && (
        <IssueDetailPanel issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
      )}
    </div>
  );
}
