import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { Database, CloudProvider } from '@/types';
import { groupDatabasesByCloudAndRegion, getAllRegions, type RegionGroup } from '@/utils/aggregation';

interface FleetHeatmapProps {
  databases: Database[];
  onRegionSelect: (group: RegionGroup | null) => void;
  selectedGroup: RegionGroup | null;
}

function getHealthColor(db: Database): string {
  switch (db.healthStatus) {
    case 'critical':
      return 'bg-red-500 hover:bg-red-600';
    case 'warning':
      return 'bg-yellow-500 hover:bg-yellow-600';
    case 'excellent':
    case 'good':
      return 'bg-green-500 hover:bg-green-600';
    default:
      return 'bg-gray-500 hover:bg-gray-600';
  }
}

function DatabaseDot({ database }: { database: Database }) {
  return (
    <div
      className={cn(
        'w-3 h-3 rounded-full transition-colors cursor-pointer',
        getHealthColor(database)
      )}
      title={`${database.name} (${database.healthStatus} • ${database.type})`}
    />
  );
}

export function FleetHeatmap({ databases, onRegionSelect, selectedGroup }: FleetHeatmapProps) {
  const cloudMap = groupDatabasesByCloudAndRegion(databases);
  const allRegions = getAllRegions(databases);

  // Get cloud providers sorted
  const clouds: CloudProvider[] = Array.from(cloudMap.keys()).sort();

  const handleCellClick = (cloud: CloudProvider, region: string) => {
    const regionMap = cloudMap.get(cloud);
    if (!regionMap) return;

    const dbs = regionMap.get(region);
    if (!dbs) return;

    const group: RegionGroup = {
      cloud,
      region,
      databases: dbs,
      criticalCount: dbs.filter((db) => db.healthStatus === 'critical').length,
      warningCount: dbs.filter((db) => db.healthStatus === 'warning').length,
      healthyCount: dbs.filter(
        (db) => db.healthStatus === 'excellent' || db.healthStatus === 'good'
      ).length,
    };

    onRegionSelect(group);
  };

  return (
    <Card className="p-6">
      <div className="space-y-4">
        {/* Legend */}
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Fleet Health Heatmap</h3>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
              <span>Healthy</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
              <span>Warning</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
              <span>Critical</span>
            </div>
          </div>
        </div>

        {/* Heatmap Grid */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left text-sm font-medium text-muted-foreground p-2 border-b">
                  Cloud
                </th>
                {allRegions.map((region) => (
                  <th
                    key={region}
                    className="text-center text-xs font-medium text-muted-foreground p-2 border-b"
                  >
                    {region}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clouds.map((cloud) => {
                const regionMap = cloudMap.get(cloud)!;
                return (
                  <tr key={cloud}>
                    <td className="text-sm font-medium p-2 border-b">
                      <span className="uppercase">{cloud}</span>
                    </td>
                    {allRegions.map((region) => {
                      const dbs = regionMap.get(region) || [];
                      const isSelected =
                        selectedGroup?.cloud === cloud && selectedGroup?.region === region;

                      return (
                        <td
                          key={region}
                          className={cn(
                            'p-2 border-b cursor-pointer hover:bg-muted/50 transition-colors',
                            isSelected && 'bg-primary/10 ring-2 ring-primary'
                          )}
                          onClick={() => dbs.length > 0 && handleCellClick(cloud, region)}
                        >
                          {dbs.length > 0 ? (
                            <div className="space-y-1">
                              {/* Database dots */}
                              <div className="flex flex-wrap gap-1 justify-center">
                                {dbs.map((db) => (
                                  <DatabaseDot key={db.id} database={db} />
                                ))}
                              </div>
                              {/* Count */}
                              <div className="text-xs text-center text-muted-foreground">
                                ({dbs.length} DB{dbs.length !== 1 ? 's' : ''})
                              </div>
                            </div>
                          ) : (
                            <div className="text-center text-muted-foreground">-</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          Click any cell to view detailed database information for that region
        </p>
      </div>
    </Card>
  );
}
