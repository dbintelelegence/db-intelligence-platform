import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, type RegionGroup } from '@/utils/aggregation';
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import type { Database } from '@/types';

interface ProblemSummaryPanelProps {
  group: RegionGroup | null;
}

function DatabaseListItem({ database }: { database: Database }) {
  const navigate = useNavigate();

  const getStatusColor = () => {
    switch (database.healthStatus) {
      case 'critical':
        return 'text-red-600 dark:text-red-400';
      case 'warning':
        return 'text-yellow-600 dark:text-yellow-400';
      default:
        return 'text-green-600 dark:text-green-400';
    }
  };

  const getStatusIcon = () => {
    switch (database.healthStatus) {
      case 'critical':
        return <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />;
      default:
        return <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />;
    }
  };

  const getHealthDetails = () => {
    const issues: string[] = [];
    if (database.metrics.cpu >= 85) issues.push(`CPU ${Math.round(database.metrics.cpu)}%`);
    if (database.metrics.memory >= 85)
      issues.push(`Memory ${Math.round(database.metrics.memory)}%`);
    if (database.metrics.storage >= 85)
      issues.push(`Storage ${Math.round(database.metrics.storage)}%`);
    if (database.metrics.connections >= database.metrics.maxConnections * 0.9)
      issues.push('Near connection limit');

    return issues.length > 0 ? issues.join(', ') : 'All metrics normal';
  };

  return (
    <div
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
      onClick={() => navigate(`/databases/${database.id}`)}
    >
      <div className="flex-shrink-0 mt-0.5">{getStatusIcon()}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{database.name}</span>
          <Badge variant="outline" className="text-xs capitalize">
            {database.type}
          </Badge>
        </div>
        <div className={`text-sm mt-1 ${getStatusColor()}`}>{getHealthDetails()}</div>
      </div>
    </div>
  );
}

export function ProblemSummaryPanel({ group }: ProblemSummaryPanelProps) {
  if (!group) {
    return (
      <Card className="p-12">
        <div className="text-center text-muted-foreground">
          <p>Click any cell in the heatmap above to view database details</p>
        </div>
      </Card>
    );
  }

  const { cloud, region, databases, criticalCount, warningCount, healthyCount } = group;

  const criticalDbs = databases.filter((db) => db.healthStatus === 'critical');
  const warningDbs = databases.filter((db) => db.healthStatus === 'warning');
  const healthyDbs = databases.filter(
    (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
  );

  const totalCost = databases.reduce((sum, db) => sum + db.monthlyCost, 0);
  const avgLatency =
    databases.reduce((sum, db) => sum + db.metrics.latency, 0) / databases.length;
  const totalIssues = databases.reduce((sum, db) => sum + db.activeIssues, 0);

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h3 className="text-lg font-semibold mb-2">
            {region} ({cloud.toUpperCase()})
          </h3>
          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span>
              {databases.length} database{databases.length !== 1 ? 's' : ''}
            </span>
            <span>•</span>
            <span>{criticalCount} critical</span>
            <span>•</span>
            <span>{warningCount} warning</span>
            <span>•</span>
            <span>{healthyCount} healthy</span>
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1 flex-wrap">
            <span>{formatCurrency(totalCost)}/mo</span>
            <span>•</span>
            <span>Latency: {Math.round(avgLatency)}ms avg</span>
            <span>•</span>
            <span>
              {totalIssues} active issue{totalIssues !== 1 ? 's' : ''}
            </span>
          </div>
        </div>

        {/* Critical Databases */}
        {criticalDbs.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <h4 className="font-semibold text-red-600 dark:text-red-400">
                Critical ({criticalCount})
              </h4>
            </div>
            <div className="space-y-1">
              {criticalDbs.map((db) => (
                <DatabaseListItem key={db.id} database={db} />
              ))}
            </div>
          </div>
        )}

        {/* Warning Databases */}
        {warningDbs.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <h4 className="font-semibold text-yellow-600 dark:text-yellow-400">
                Warning ({warningCount})
              </h4>
            </div>
            <div className="space-y-1">
              {warningDbs.map((db) => (
                <DatabaseListItem key={db.id} database={db} />
              ))}
            </div>
          </div>
        )}

        {/* Healthy Databases */}
        {healthyDbs.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
              <h4 className="font-semibold text-green-600 dark:text-green-400">
                Healthy ({healthyCount})
              </h4>
            </div>
            <div className="text-sm text-muted-foreground">
              {healthyDbs.map((db) => db.name).join(', ')}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
