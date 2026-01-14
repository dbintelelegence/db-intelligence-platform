export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertType = 'performance' | 'availability' | 'security' | 'cost' | 'capacity';
export type AlertStatus = 'unread' | 'read' | 'dismissed';

export interface Alert {
  id: string;
  databaseId: string;
  databaseName: string;

  // Classification
  severity: AlertSeverity;
  type: AlertType;
  status: AlertStatus;

  // Content
  title: string;
  message: string;
  details?: string;

  // Timing
  timestamp: Date;

  // Actions
  actionUrl?: string;
  actionLabel?: string;

  // Metadata
  source: string; // e.g., "Monitoring System", "Cost Analyzer", "Security Scanner"
  tags?: string[];
}

export interface AlertPreferences {
  emailEnabled: boolean;
  slackEnabled: boolean;
  pushEnabled: boolean;
  minSeverity: AlertSeverity;
  mutedTypes: AlertType[];
  quietHoursStart?: string; // HH:MM format
  quietHoursEnd?: string; // HH:MM format
}
