export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueCategory = 'performance' | 'capacity' | 'availability' | 'configuration' | 'cost';
export type IssueStatus = 'active' | 'acknowledged' | 'resolved';

export interface LogEntry {
  timestamp: Date;
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  source: string;
}

export interface ChangeEvent {
  timestamp: Date;
  type: 'deployment' | 'config_change' | 'scaling' | 'migration' | 'maintenance';
  description: string;
  author?: string;
}

export interface Issue {
  id: string;
  databaseId: string;
  databaseName: string;

  // Classification
  severity: IssueSeverity;
  category: IssueCategory;
  status: IssueStatus;

  // Description
  title: string;
  description: string;       // Brief description
  explanation: string;        // AI-generated detailed explanation
  recommendation: string;     // What to do about it

  // Context
  detectedAt: Date;
  firstSeen: Date;
  lastSeen: Date;
  occurrences: number;

  // Correlation
  relatedMetrics: string[];  // Metric names that correlate
  relatedLogs: LogEntry[];
  relatedChanges: ChangeEvent[];

  // Impact
  affectedServices?: string[];
}
