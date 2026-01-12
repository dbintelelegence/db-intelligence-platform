import type { Issue, IssueCategory, LogEntry, ChangeEvent, Database } from '@/types';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function generatePastTimestamp(minutesAgo: number): Date {
  return new Date(Date.now() - minutesAgo * 60 * 1000);
}

const ISSUE_TEMPLATES = {
  critical_performance: [
    {
      title: 'High CPU utilization detected',
      description: (db: Database) => `CPU usage consistently above ${db.metrics.cpu}% for extended period`,
      explanation: 'Sustained high CPU usage indicates the database is processing more queries than it can efficiently handle. This can lead to increased latency, query timeouts, and degraded user experience.',
      recommendation: 'Consider scaling up the instance size, optimizing slow queries, or implementing read replicas to distribute load.',
      category: 'performance' as IssueCategory,
    },
    {
      title: 'Memory pressure detected',
      description: (db: Database) => `Memory usage at ${db.metrics.memory}%, experiencing frequent cache evictions`,
      explanation: 'High memory utilization is causing the database to evict cached data prematurely, leading to more disk I/O and slower query performance.',
      recommendation: 'Increase instance memory, optimize query result sets, or review connection pooling configuration.',
      category: 'capacity' as IssueCategory,
    },
    {
      title: 'Connection pool exhausted',
      description: (db: Database) => `All ${db.metrics.maxConnections} connections in use, new requests queuing`,
      explanation: 'The database has reached its maximum connection limit. New connection requests are being queued or rejected, impacting application availability.',
      recommendation: 'Increase max_connections setting, implement connection pooling at application level, or investigate connection leaks.',
      category: 'capacity' as IssueCategory,
    },
  ],
  warning_performance: [
    {
      title: 'Elevated query latency',
      description: (db: Database) => `Average query latency increased to ${db.metrics.latency}ms`,
      explanation: 'Query response times have increased beyond normal thresholds. This may indicate missing indexes, table locks, or resource contention.',
      recommendation: 'Review slow query logs, check for missing indexes, and analyze query execution plans.',
      category: 'performance' as IssueCategory,
    },
    {
      title: 'Storage capacity approaching limit',
      description: (db: Database) => `Storage utilization at ${db.metrics.storage}%`,
      explanation: 'Database storage is nearing capacity. Running out of storage will cause write operations to fail and may lead to database corruption.',
      recommendation: 'Increase storage allocation, implement data archival strategy, or clean up unnecessary data.',
      category: 'capacity' as IssueCategory,
    },
    {
      title: 'Increased replication lag',
      description: () => `Replica is ${randomInt(5, 30)} seconds behind primary`,
      explanation: 'Read replicas are falling behind the primary database, which may cause stale data reads and inconsistencies.',
      recommendation: 'Check network connectivity, review replica instance size, or reduce write load on primary.',
      category: 'availability' as IssueCategory,
    },
  ],
  info: [
    {
      title: 'Scheduled maintenance window upcoming',
      description: () => `Maintenance scheduled for ${new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString()}`,
      explanation: 'A routine maintenance window has been scheduled. Brief downtime or degraded performance may occur.',
      recommendation: 'Plan accordingly and notify stakeholders. Consider scheduling during low-traffic periods.',
      category: 'configuration' as IssueCategory,
    },
    {
      title: 'Minor version update available',
      description: () => 'New patch version available with security fixes',
      explanation: 'A minor version update is available that includes important security patches and bug fixes.',
      recommendation: 'Review release notes and schedule update during next maintenance window.',
      category: 'configuration' as IssueCategory,
    },
  ],
};

function generateLogs(issueCategory: IssueCategory): LogEntry[] {
  const logTemplates: Record<IssueCategory, Array<{ level: 'error' | 'warn' | 'info' | 'debug', message: string, source: string }>> = {
    performance: [
      { level: 'error', message: 'Query timeout: SELECT statement exceeded 30 second limit', source: 'postgresql' },
      { level: 'warn', message: 'Slow query detected: execution time 2450ms', source: 'query_monitor' },
      { level: 'error', message: 'Connection pool exhausted, rejecting new connections', source: 'connection_manager' },
    ],
    capacity: [
      { level: 'warn', message: 'Storage usage above 80% threshold', source: 'storage_monitor' },
      { level: 'error', message: 'Out of memory: failed to allocate buffer', source: 'postgresql' },
      { level: 'warn', message: 'High memory pressure, evicting cache entries', source: 'cache_manager' },
    ],
    availability: [
      { level: 'error', message: 'Replication connection lost, attempting reconnect', source: 'replication' },
      { level: 'warn', message: 'Primary database unreachable, failover initiated', source: 'ha_manager' },
    ],
    configuration: [
      { level: 'info', message: 'Configuration parameter changed: max_connections=200', source: 'admin' },
      { level: 'info', message: 'Maintenance mode enabled', source: 'admin' },
    ],
    cost: [
      { level: 'warn', message: 'Unusual cost spike detected', source: 'billing_monitor' },
    ],
  };

  const templates = logTemplates[issueCategory];
  const count = randomInt(2, 4);
  const logs: LogEntry[] = [];

  for (let i = 0; i < count; i++) {
    const template = randomChoice(templates);
    logs.push({
      timestamp: generatePastTimestamp(randomInt(10, 120)),
      ...template,
    });
  }

  return logs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

function generateChanges(): ChangeEvent[] {
  const changeTemplates = [
    { type: 'deployment' as const, description: 'Application deployment v2.3.1' },
    { type: 'config_change' as const, description: 'Updated connection pool settings' },
    { type: 'scaling' as const, description: 'Scaled from t3.medium to t3.large' },
    { type: 'maintenance' as const, description: 'Applied security patches' },
  ];

  if (Math.random() > 0.5) {
    const change = randomChoice(changeTemplates);
    return [{
      timestamp: generatePastTimestamp(randomInt(60, 240)),
      ...change,
      author: randomChoice(['john.doe', 'jane.smith', 'ops-team', 'terraform']),
    }];
  }

  return [];
}

function generateIssuesForDatabase(db: Database): Issue[] {
  const issues: Issue[] = [];

  if (db.healthStatus === 'critical') {
    // Critical databases get 3-5 critical/warning issues
    const criticalCount = randomInt(2, 3);
    const warningCount = randomInt(1, 2);

    for (let i = 0; i < criticalCount; i++) {
      const template = randomChoice(ISSUE_TEMPLATES.critical_performance);
      issues.push({
        id: `issue-${db.id}-critical-${i}`,
        databaseId: db.id,
        databaseName: db.name,
        severity: 'critical',
        category: template.category,
        status: 'active',
        title: template.title,
        description: template.description(db),
        explanation: template.explanation,
        recommendation: template.recommendation,
        detectedAt: generatePastTimestamp(randomInt(30, 180)),
        firstSeen: generatePastTimestamp(randomInt(180, 720)),
        lastSeen: generatePastTimestamp(randomInt(1, 10)),
        occurrences: randomInt(10, 50),
        relatedMetrics: ['cpu', 'memory', 'latency'],
        relatedLogs: generateLogs(template.category),
        relatedChanges: generateChanges(),
      });
    }

    for (let i = 0; i < warningCount; i++) {
      const template = randomChoice(ISSUE_TEMPLATES.warning_performance);
      issues.push({
        id: `issue-${db.id}-warning-${i}`,
        databaseId: db.id,
        databaseName: db.name,
        severity: 'warning',
        category: template.category,
        status: 'active',
        title: template.title,
        description: template.description(db),
        explanation: template.explanation,
        recommendation: template.recommendation,
        detectedAt: generatePastTimestamp(randomInt(60, 300)),
        firstSeen: generatePastTimestamp(randomInt(300, 1440)),
        lastSeen: generatePastTimestamp(randomInt(5, 30)),
        occurrences: randomInt(5, 20),
        relatedMetrics: ['storage', 'connections'],
        relatedLogs: generateLogs(template.category),
        relatedChanges: generateChanges(),
      });
    }
  } else if (db.healthStatus === 'warning') {
    // Warning databases get 1-3 warning issues
    const count = randomInt(1, 3);

    for (let i = 0; i < count; i++) {
      const template = randomChoice(ISSUE_TEMPLATES.warning_performance);
      issues.push({
        id: `issue-${db.id}-warning-${i}`,
        databaseId: db.id,
        databaseName: db.name,
        severity: 'warning',
        category: template.category,
        status: 'active',
        title: template.title,
        description: template.description(db),
        explanation: template.explanation,
        recommendation: template.recommendation,
        detectedAt: generatePastTimestamp(randomInt(60, 360)),
        firstSeen: generatePastTimestamp(randomInt(360, 1440)),
        lastSeen: generatePastTimestamp(randomInt(10, 60)),
        occurrences: randomInt(3, 15),
        relatedMetrics: randomChoice([['cpu'], ['memory'], ['latency'], ['storage']]),
        relatedLogs: generateLogs(template.category),
        relatedChanges: generateChanges(),
      });
    }
  } else if (db.healthStatus === 'good' && Math.random() > 0.7) {
    // Some healthy databases might have info-level issues
    const template = randomChoice(ISSUE_TEMPLATES.info);
    issues.push({
      id: `issue-${db.id}-info-0`,
      databaseId: db.id,
      databaseName: db.name,
      severity: 'info',
      category: template.category,
      status: 'active',
      title: template.title,
      description: template.description(),
      explanation: template.explanation,
      recommendation: template.recommendation,
      detectedAt: generatePastTimestamp(randomInt(120, 720)),
      firstSeen: generatePastTimestamp(randomInt(720, 2880)),
      lastSeen: generatePastTimestamp(randomInt(60, 180)),
      occurrences: 1,
      relatedMetrics: [],
      relatedLogs: generateLogs(template.category),
      relatedChanges: generateChanges(),
    });
  }

  return issues;
}

export function generateIssues(databases: Database[]): Issue[] {
  const allIssues: Issue[] = [];

  for (const db of databases) {
    const dbIssues = generateIssuesForDatabase(db);
    allIssues.push(...dbIssues);
  }

  // Sort by severity (critical first) then by detection time (newest first)
  return allIssues.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return b.detectedAt.getTime() - a.detectedAt.getTime();
  });
}
