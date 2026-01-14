import type { Alert, AlertSeverity, AlertType, AlertStatus, Database } from '@/types';

const alertTemplates = {
  performance: [
    {
      severity: 'critical' as AlertSeverity,
      title: 'High CPU Usage Alert',
      messageTemplate: (db: string) => `${db} is experiencing CPU usage above 90% for the last 15 minutes`,
      details: 'CPU utilization has exceeded threshold. Consider scaling up or optimizing queries.',
      source: 'Performance Monitor',
      actionLabel: 'View Metrics',
      tags: ['cpu', 'performance'],
    },
    {
      severity: 'warning' as AlertSeverity,
      title: 'Slow Query Detected',
      messageTemplate: (db: string) => `Multiple slow queries detected on ${db}`,
      details: 'Query execution times are higher than baseline. Review query performance.',
      source: 'Query Analyzer',
      actionLabel: 'View Queries',
      tags: ['query', 'performance'],
    },
    {
      severity: 'warning' as AlertSeverity,
      title: 'Memory Usage High',
      messageTemplate: (db: string) => `${db} memory usage at 85%`,
      details: 'Memory consumption is approaching limits. Monitor for potential issues.',
      source: 'Resource Monitor',
      actionLabel: 'View Details',
      tags: ['memory', 'resources'],
    },
  ],
  availability: [
    {
      severity: 'critical' as AlertSeverity,
      title: 'Database Connection Failed',
      messageTemplate: (db: string) => `Unable to connect to ${db}`,
      details: 'Connection attempts are failing. Database may be down or unreachable.',
      source: 'Health Check',
      actionLabel: 'Check Status',
      tags: ['connection', 'downtime'],
    },
    {
      severity: 'critical' as AlertSeverity,
      title: 'Replication Lag Detected',
      messageTemplate: (db: string) => `${db} replica is lagging behind primary by 5+ minutes`,
      details: 'Replication lag may impact read consistency. Check replica health.',
      source: 'Replication Monitor',
      actionLabel: 'View Replication',
      tags: ['replication', 'lag'],
    },
    {
      severity: 'warning' as AlertSeverity,
      title: 'High Connection Count',
      messageTemplate: (db: string) => `${db} has reached 90% of max connections`,
      details: 'Connection pool is nearly exhausted. Consider increasing limits or closing idle connections.',
      source: 'Connection Monitor',
      actionLabel: 'View Connections',
      tags: ['connections', 'capacity'],
    },
  ],
  security: [
    {
      severity: 'critical' as AlertSeverity,
      title: 'Unauthorized Access Attempt',
      messageTemplate: (db: string) => `Multiple failed login attempts detected on ${db}`,
      details: 'Potential security breach. Review access logs and consider blocking suspicious IPs.',
      source: 'Security Scanner',
      actionLabel: 'View Logs',
      tags: ['security', 'authentication'],
    },
    {
      severity: 'warning' as AlertSeverity,
      title: 'SSL Certificate Expiring Soon',
      messageTemplate: (db: string) => `SSL certificate for ${db} expires in 14 days`,
      details: 'Renew certificate to prevent connection issues.',
      source: 'Certificate Monitor',
      actionLabel: 'Renew Certificate',
      tags: ['ssl', 'certificate'],
    },
    {
      severity: 'info' as AlertSeverity,
      title: 'Security Patch Available',
      messageTemplate: (db: string) => `Security update available for ${db}`,
      details: 'A new security patch has been released. Schedule maintenance window to apply.',
      source: 'Update Monitor',
      actionLabel: 'View Patch Notes',
      tags: ['security', 'updates'],
    },
  ],
  cost: [
    {
      severity: 'warning' as AlertSeverity,
      title: 'Cost Spike Detected',
      messageTemplate: (db: string) => `${db} costs increased by 45% this week`,
      details: 'Unusual cost increase detected. Review recent changes and usage patterns.',
      source: 'Cost Analyzer',
      actionLabel: 'View Costs',
      tags: ['cost', 'billing'],
    },
    {
      severity: 'info' as AlertSeverity,
      title: 'Cost Optimization Opportunity',
      messageTemplate: (db: string) => `${db} may benefit from reserved instance pricing`,
      details: 'Stable usage patterns detected. Switching to reserved instances could save 30%.',
      source: 'Cost Optimizer',
      actionLabel: 'View Recommendations',
      tags: ['cost', 'optimization'],
    },
  ],
  capacity: [
    {
      severity: 'critical' as AlertSeverity,
      title: 'Storage Almost Full',
      messageTemplate: (db: string) => `${db} storage at 95% capacity`,
      details: 'Database will run out of storage soon. Increase capacity immediately.',
      source: 'Storage Monitor',
      actionLabel: 'Increase Storage',
      tags: ['storage', 'capacity'],
    },
    {
      severity: 'warning' as AlertSeverity,
      title: 'IOPS Limit Approaching',
      messageTemplate: (db: string) => `${db} is using 85% of provisioned IOPS`,
      details: 'I/O operations approaching limit. Performance may degrade.',
      source: 'Performance Monitor',
      actionLabel: 'View Metrics',
      tags: ['iops', 'performance'],
    },
  ],
};

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function getRandomStatus(): AlertStatus {
  const rand = Math.random();
  if (rand < 0.3) return 'unread';
  if (rand < 0.7) return 'read';
  return 'dismissed';
}

function generateRandomDate(daysAgo: number): Date {
  const now = new Date();
  const hoursAgo = Math.random() * daysAgo * 24;
  return new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
}

export function generateAlerts(databases: Database[]): Alert[] {
  const alerts: Alert[] = [];
  let idCounter = 1;

  // Generate 30-50 alerts
  const alertCount = 30 + Math.floor(Math.random() * 20);

  for (let i = 0; i < alertCount; i++) {
    const db = getRandomElement(databases);
    const type = getRandomElement(['performance', 'availability', 'security', 'cost', 'capacity'] as AlertType[]);
    const template = getRandomElement(alertTemplates[type]);

    const alert: Alert = {
      id: `alert-${idCounter++}`,
      databaseId: db.id,
      databaseName: db.name,
      severity: template.severity,
      type,
      status: getRandomStatus(),
      title: template.title,
      message: template.messageTemplate(db.name),
      details: template.details,
      timestamp: generateRandomDate(7), // Alerts from last 7 days
      source: template.source,
      actionLabel: template.actionLabel,
      actionUrl: `/databases/${db.id}`,
      tags: template.tags,
    };

    alerts.push(alert);
  }

  // Sort by timestamp (newest first)
  alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return alerts;
}
