import { Search, X } from 'lucide-react';
import type { IssueSeverity, IssueCategory } from '@/types';

interface IssuesFiltersProps {
  searchQuery: string;
  severityFilter: IssueSeverity | 'all';
  categoryFilter: IssueCategory | 'all';
  onSearchChange: (query: string) => void;
  onSeverityChange: (severity: IssueSeverity | 'all') => void;
  onCategoryChange: (category: IssueCategory | 'all') => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

export function IssuesFilters({
  searchQuery,
  severityFilter,
  categoryFilter,
  onSearchChange,
  onSeverityChange,
  onCategoryChange,
  onClearFilters,
  hasActiveFilters,
}: IssuesFiltersProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center flex-1">
        {/* Search Input */}
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search issues or databases..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>

        {/* Severity Filter */}
        <select
          value={severityFilter}
          onChange={(e) => onSeverityChange(e.target.value as IssueSeverity | 'all')}
          className="px-3 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>

        {/* Category Filter */}
        <select
          value={categoryFilter}
          onChange={(e) => onCategoryChange(e.target.value as IssueCategory | 'all')}
          className="px-3 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="all">All Categories</option>
          <option value="performance">Performance</option>
          <option value="capacity">Capacity</option>
          <option value="availability">Availability</option>
          <option value="configuration">Configuration</option>
          <option value="cost">Cost</option>
        </select>
      </div>

      {/* Clear Filters Button */}
      {hasActiveFilters && (
        <button
          onClick={onClearFilters}
          className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
          Clear Filters
        </button>
      )}
    </div>
  );
}
