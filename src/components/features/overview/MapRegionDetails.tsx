import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, AlertTriangle, CheckCircle, MapPin, Server } from 'lucide-react';
import type { RegionMarker } from '@/utils/map-coordinates';
import { formatCurrency } from '@/utils/map-coordinates';
import { cn } from '@/lib/utils';

interface MapRegionDetailsProps {
  marker: RegionMarker | null;
}

export function MapRegionDetails({ marker }: MapRegionDetailsProps) {
  const navigate = useNavigate();

  const stats = useMemo(() => {
    if (!marker) return null;

    const totalCost = marker.databases.reduce(
      (sum, db) => sum + db.monthlyCost,
      0
    );

    const avgLatency =
      marker.databases.reduce((sum, db) => sum + db.metrics.latency, 0) /
      marker.databases.length;

    const totalIssues = marker.databases.reduce(
      (sum, db) => sum + db.activeIssues,
      0
    );

    return {
      totalCost,
      avgLatency: Math.round(avgLatency),
      totalIssues,
    };
  }, [marker]);

  if (!marker) {
    return (
      <Card className="p-8 text-center">
        <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Region Selected</h3>
        <p className="text-sm text-muted-foreground">
          Click any region marker on the map above to view details
        </p>
      </Card>
    );
  }

  const criticalDatabases = marker.databases.filter(
    (db) => db.healthStatus === 'critical'
  );
  const warningDatabases = marker.databases.filter(
    (db) => db.healthStatus === 'warning'
  );

  return (
    <Card className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="h-5 w-5 text-primary" />
            <h3 className="text-xl font-semibold">{marker.region}</h3>
            <Badge variant="outline" className="uppercase text-xs">
              {marker.cloud}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {marker.databases.length} database
            {marker.databases.length !== 1 ? 's' : ''} in this region
          </p>
        </div>

        <Button
          size="sm"
          onClick={() =>
            navigate(
              `/databases?cloud=${marker.cloud}&region=${marker.region}`
            )
          }
        >
          View All
        </Button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground mb-1">
            Monthly Cost
          </div>
          <div className="text-lg font-semibold">
            {formatCurrency(stats?.totalCost || 0)}
          </div>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground mb-1">
            Avg Latency
          </div>
          <div className="text-lg font-semibold">{stats?.avgLatency}ms</div>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground mb-1">
            Active Issues
          </div>
          <div className="text-lg font-semibold">{stats?.totalIssues}</div>
        </div>
        <div className="p-3 bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground mb-1">Healthy</div>
          <div className="text-lg font-semibold text-green-600">
            {marker.healthyCount}
          </div>
        </div>
      </div>

      {/* Critical Databases */}
      {criticalDatabases.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <h4 className="font-semibold text-red-700 dark:text-red-400">
              Critical Databases ({criticalDatabases.length})
            </h4>
          </div>
          <div className="space-y-2">
            {criticalDatabases.map((db) => (
              <div
                key={db.id}
                className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                onClick={() => navigate(`/database/${db.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Server className="h-3 w-3 text-red-600" />
                      <span className="font-medium text-sm">{db.name}</span>
                      <Badge
                        variant="outline"
                        className="text-xs bg-white dark:bg-gray-800"
                      >
                        {db.type}
                      </Badge>
                    </div>
                    {db.activeIssues > 0 && (
                      <div className="text-xs text-red-700 dark:text-red-300">
                        {db.activeIssues} active issue
                        {db.activeIssues !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>CPU: {db.metrics.cpu}%</div>
                    <div>Mem: {db.metrics.memory}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warning Databases */}
      {warningDatabases.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <h4 className="font-semibold text-yellow-700 dark:text-yellow-400">
              Warning Databases ({warningDatabases.length})
            </h4>
          </div>
          <div className="space-y-2">
            {warningDatabases.map((db) => (
              <div
                key={db.id}
                className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors"
                onClick={() => navigate(`/database/${db.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Server className="h-3 w-3 text-yellow-600" />
                      <span className="font-medium text-sm">{db.name}</span>
                      <Badge
                        variant="outline"
                        className="text-xs bg-white dark:bg-gray-800"
                      >
                        {db.type}
                      </Badge>
                    </div>
                    {db.activeIssues > 0 && (
                      <div className="text-xs text-yellow-700 dark:text-yellow-300">
                        {db.activeIssues} active issue
                        {db.activeIssues !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>CPU: {db.metrics.cpu}%</div>
                    <div>Mem: {db.metrics.memory}%</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Healthy Databases */}
      {marker.healthyCount > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <h4 className="font-semibold text-green-700 dark:text-green-400">
              Healthy Databases ({marker.healthyCount})
            </h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {marker.databases
              .filter(
                (db) =>
                  db.healthStatus === 'excellent' ||
                  db.healthStatus === 'good'
              )
              .slice(0, 10)
              .map((db) => (
                <button
                  key={db.id}
                  onClick={() => navigate(`/database/${db.id}`)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium',
                    'bg-green-50 dark:bg-green-900/20',
                    'text-green-700 dark:text-green-300',
                    'border border-green-200 dark:border-green-800',
                    'hover:bg-green-100 dark:hover:bg-green-900/30',
                    'transition-colors cursor-pointer'
                  )}
                >
                  {db.name}
                </button>
              ))}
            {marker.healthyCount > 10 && (
              <div className="px-3 py-1.5 text-xs text-muted-foreground">
                +{marker.healthyCount - 10} more
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
