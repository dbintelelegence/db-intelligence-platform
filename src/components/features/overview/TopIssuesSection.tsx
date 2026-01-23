import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/ui/card';
import { AlertCircle, AlertTriangle, Clock } from 'lucide-react';
import type { Database } from '@/types';

interface TopIssuesSectionProps {
  databases: Database[];
}

interface IntelligentIssue {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning';
  database: Database;
  timestamp: string;
}

function generateIntelligentIssues(databases: Database[]): IntelligentIssue[] {
  const issues: IntelligentIssue[] = [];

  // Find critical databases and generate contextual issues
  databases.forEach((db) => {
    const metrics = db.metrics;

    // High CPU
    if (metrics.cpu > 85) {
      issues.push({
        id: `${db.id}-cpu`,
        title: `CPU saturation on ${db.name}`,
        description: `CPU at ${metrics.cpu}%, correlated with ${metrics.connections} active connections and ${metrics.throughput} qps`,
        severity: metrics.cpu > 90 ? 'critical' : 'warning',
        database: db,
        timestamp: '2 hours ago',
      });
    }

    // High memory
    if (metrics.memory > 85) {
      issues.push({
        id: `${db.id}-memory`,
        title: `Memory pressure on ${db.name}`,
        description: `Memory usage at ${metrics.memory}%, may affect query performance`,
        severity: metrics.memory > 90 ? 'critical' : 'warning',
        database: db,
        timestamp: '1 hour ago',
      });
    }

    // High storage
    if (metrics.storage > 80) {
      issues.push({
        id: `${db.id}-storage`,
        title: `Storage capacity warning on ${db.name}`,
        description: `Disk usage at ${metrics.storage}%, estimated ${Math.round((100 - metrics.storage) / 5)} days until full`,
        severity: metrics.storage > 90 ? 'critical' : 'warning',
        database: db,
        timestamp: '3 hours ago',
      });
    }

    // High latency
    if (metrics.latency > 100) {
      issues.push({
        id: `${db.id}-latency`,
        title: `Elevated latency on ${db.name}`,
        description: `Average latency ${metrics.latency}ms, ${Math.round(metrics.latency / 50)}x normal baseline`,
        severity: metrics.latency > 200 ? 'critical' : 'warning',
        database: db,
        timestamp: '30 minutes ago',
      });
    }

    // Connection pool saturation
    if (metrics.connections / metrics.maxConnections > 0.85) {
      const percentage = Math.round(
        (metrics.connections / metrics.maxConnections) * 100
      );
      issues.push({
        id: `${db.id}-connections`,
        title: `Connection pool exhaustion on ${db.name}`,
        description: `${metrics.connections}/${metrics.maxConnections} connections (${percentage}%), applications may experience timeouts`,
        severity: percentage > 95 ? 'critical' : 'warning',
        database: db,
        timestamp: '15 minutes ago',
      });
    }
  });

  // Sort by severity (critical first) and limit to top 5
  return issues
    .sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (a.severity !== 'critical' && b.severity === 'critical') return 1;
      return 0;
    })
    .slice(0, 5);
}

export function TopIssuesSection({ databases }: TopIssuesSectionProps) {
  const navigate = useNavigate();
  const issues = useMemo(
    () => generateIntelligentIssues(databases),
    [databases]
  );

  if (issues.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="flex justify-center mb-4">
          <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900/20 flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
          </div>
        </div>
        <h3 className="text-lg font-semibold mb-2">All Clear</h3>
        <p className="text-sm text-muted-foreground">
          No issues detected across your database fleet
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-xl font-semibold">What needs attention</h3>
        <p className="text-sm text-muted-foreground">
          Ranked by severity and impact
        </p>
      </div>

      <div className="space-y-4">
        {issues.map((issue) => (
          <div
            key={issue.id}
            className="p-4 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => navigate(`/database/${issue.database.id}`)}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="mt-0.5">
                {issue.severity === 'critical' ? (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-yellow-500" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1">
                <div className="flex items-start justify-between mb-1">
                  <h4 className="font-semibold text-sm">{issue.title}</h4>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {issue.timestamp}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {issue.description}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                    {issue.database.cloud.toUpperCase()}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                    {issue.database.region}
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted uppercase">
                    {issue.database.type}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
