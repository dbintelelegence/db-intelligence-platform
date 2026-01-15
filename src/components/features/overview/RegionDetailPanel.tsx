import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCurrency, type TreeNode } from '@/utils/tree-navigation';
import type { Database } from '@/types';
import { AlertCircle, AlertTriangle, CheckCircle, TrendingUp, Activity } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

interface RegionDetailPanelProps {
  selectedNode: TreeNode | null;
  databases: Database[];
}

function DatabaseListItem({ database }: { database: Database }) {
  const navigate = useNavigate();

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

  return (
    <div
      className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors border"
      onClick={() => navigate(`/databases/${database.id}`)}
    >
      {getStatusIcon()}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium">{database.name}</span>
          <Badge variant="outline" className="text-xs">
            {database.type}
          </Badge>
        </div>
        <div className="text-sm text-muted-foreground mt-0.5">
          CPU {Math.round(database.metrics.cpu)}% • Memory {Math.round(database.metrics.memory)}% •
          Health {database.healthScore}%
        </div>
      </div>
      <div className="text-sm text-muted-foreground text-right">
        {formatCurrency(database.monthlyCost)}/mo
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="p-12">
      <div className="text-center text-muted-foreground">
        <Activity className="h-12 w-12 mx-auto mb-4 opacity-20" />
        <p className="text-lg font-medium mb-2">Select a node from the tree</p>
        <p className="text-sm">
          Choose a cloud provider, region, or database from the navigator on the left to view
          details
        </p>
      </div>
    </Card>
  );
}

export function RegionDetailPanel({ selectedNode, databases }: RegionDetailPanelProps) {
  const navigate = useNavigate();

  if (!selectedNode || databases.length === 0) {
    return <EmptyState />;
  }

  // Calculate metrics
  const totalCost = databases.reduce((sum, db) => sum + db.monthlyCost, 0);
  const avgHealthScore = databases.reduce((sum, db) => sum + db.healthScore, 0) / databases.length;
  const totalIssues = databases.reduce((sum, db) => sum + db.activeIssues, 0);
  const avgLatency = databases.reduce((sum, db) => sum + db.metrics.latency, 0) / databases.length;

  const criticalDbs = databases.filter((db) => db.healthStatus === 'critical');
  const warningDbs = databases.filter((db) => db.healthStatus === 'warning');
  const healthyDbs = databases.filter(
    (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
  );

  // Generate mock health trend data (7 days)
  const healthTrendData = Array.from({ length: 7 }, (_, i) => ({
    day: i + 1,
    health: avgHealthScore + (Math.random() - 0.5) * 10,
  }));

  const getTitle = () => {
    if (selectedNode.type === 'database' && selectedNode.database) {
      return selectedNode.database.name;
    }
    if (selectedNode.type === 'region') {
      return `${selectedNode.region} (${selectedNode.cloud?.toUpperCase()})`;
    }
    if (selectedNode.type === 'cloud') {
      return selectedNode.cloud?.toUpperCase();
    }
    return 'Overview';
  };

  return (
    <Card className="p-6">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xl font-semibold">{getTitle()}</h3>
            {selectedNode.type !== 'database' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (selectedNode.type === 'region') {
                    navigate(
                      `/databases?cloud=${selectedNode.cloud}&region=${selectedNode.region}`
                    );
                  } else if (selectedNode.type === 'cloud') {
                    navigate(`/databases?cloud=${selectedNode.cloud}`);
                  }
                }}
              >
                View All
              </Button>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
            <span>
              {databases.length} database{databases.length !== 1 ? 's' : ''}
            </span>
            <span>•</span>
            <span>{criticalDbs.length} critical</span>
            <span>•</span>
            <span>{warningDbs.length} warning</span>
            <span>•</span>
            <span>{healthyDbs.length} healthy</span>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Monthly Cost</div>
            <div className="text-2xl font-bold">{formatCurrency(totalCost)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Avg Health</div>
            <div className="text-2xl font-bold">{Math.round(avgHealthScore)}%</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Active Issues</div>
            <div className="text-2xl font-bold">{totalIssues}</div>
          </Card>
          <Card className="p-4">
            <div className="text-sm text-muted-foreground mb-1">Avg Latency</div>
            <div className="text-2xl font-bold">{Math.round(avgLatency)}ms</div>
          </Card>
        </div>

        {/* Health Trend Chart */}
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h4 className="font-semibold">Health Trend (7 days)</h4>
          </div>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={healthTrendData}>
                <XAxis dataKey="day" tick={{ fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Line
                  type="monotone"
                  dataKey="health"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Top Issues */}
        {totalIssues > 0 && (
          <div>
            <h4 className="font-semibold mb-3">Top Issues</h4>
            <ul className="space-y-2 text-sm">
              {criticalDbs.slice(0, 3).map((db) => (
                <li key={db.id} className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                  <span>
                    <span className="font-medium">{db.name}:</span> High CPU (
                    {Math.round(db.metrics.cpu)}%)
                  </span>
                </li>
              ))}
              {warningDbs.slice(0, 2).map((db) => (
                <li key={db.id} className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
                  <span>
                    <span className="font-medium">{db.name}:</span> Storage at{' '}
                    {Math.round(db.metrics.storage)}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Database List */}
        <div>
          <h4 className="font-semibold mb-3">
            Database List ({databases.length})
          </h4>
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {databases.slice(0, 10).map((db) => (
              <DatabaseListItem key={db.id} database={db} />
            ))}
            {databases.length > 10 && (
              <div className="text-sm text-muted-foreground text-center py-2">
                + {databases.length - 10} more databases
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
