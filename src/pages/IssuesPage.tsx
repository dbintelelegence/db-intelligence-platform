import { useState, useMemo } from 'react';
import { IssuesFilters } from '@/components/features/issues/IssuesFilters';
import { IssuesSummary } from '@/components/features/issues/IssuesSummary';
import { IssuesList } from '@/components/features/issues/IssuesList';
import { IssueDetailPanel } from '@/components/features/issues/IssueDetailPanel';
import { mockData } from '@/data/mock-data';
import type { Issue, IssueSeverity, IssueCategory } from '@/types';

export function IssuesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<IssueSeverity | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<IssueCategory | 'all'>('all');
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  // Filter issues based on search and filters
  const filteredIssues = useMemo(() => {
    let filtered = mockData.issues;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (issue) =>
          issue.title.toLowerCase().includes(query) ||
          issue.description.toLowerCase().includes(query) ||
          issue.databaseName.toLowerCase().includes(query)
      );
    }

    // Severity filter
    if (severityFilter !== 'all') {
      filtered = filtered.filter((issue) => issue.severity === severityFilter);
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter((issue) => issue.category === categoryFilter);
    }

    return filtered;
  }, [searchQuery, severityFilter, categoryFilter]);

  // Calculate counts for summary
  const counts = useMemo(() => {
    return {
      critical: filteredIssues.filter((issue) => issue.severity === 'critical').length,
      warning: filteredIssues.filter((issue) => issue.severity === 'warning').length,
      info: filteredIssues.filter((issue) => issue.severity === 'info').length,
    };
  }, [filteredIssues]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setSeverityFilter('all');
    setCategoryFilter('all');
  };

  const handleSeverityClick = (severity: IssueSeverity) => {
    setSeverityFilter(severityFilter === severity ? 'all' : severity);
  };

  const hasActiveFilters = searchQuery !== '' || severityFilter !== 'all' || categoryFilter !== 'all';

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
          Showing {filteredIssues.length} of {mockData.issues.length} issues
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
