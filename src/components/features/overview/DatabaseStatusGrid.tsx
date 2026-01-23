import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import type { Database } from '@/types';
import { cn } from '@/lib/utils';

interface DatabaseStatusGridProps {
  databases: Database[];
}

function getHealthIcon(status: Database['healthStatus']) {
  switch (status) {
    case 'excellent':
    case 'good':
      return '🟢';
    case 'warning':
      return '🟠';
    case 'critical':
      return '🔴';
    default:
      return '⚪';
  }
}

function getTrendIcon(trend: Database['healthTrend']) {
  switch (trend) {
    case 'up':
      return <ArrowUp className="h-3 w-3 text-green-500" />;
    case 'down':
      return <ArrowDown className="h-3 w-3 text-red-500" />;
    case 'stable':
      return <ArrowRight className="h-3 w-3 text-muted-foreground" />;
  }
}

export function DatabaseStatusGrid({ databases }: DatabaseStatusGridProps) {
  const navigate = useNavigate();
  const [sortField, setSortField] = useState<keyof Database>('healthStatus');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const sortedDatabases = useMemo(() => {
    const sorted = [...databases].sort((a, b) => {
      // Priority sort: critical > warning > good > excellent
      if (sortField === 'healthStatus') {
        const statusOrder = {
          critical: 0,
          warning: 1,
          good: 2,
          excellent: 3,
          unknown: 4,
        };
        const aOrder = statusOrder[a.healthStatus];
        const bOrder = statusOrder[b.healthStatus];
        return sortDirection === 'asc' ? aOrder - bOrder : bOrder - aOrder;
      }

      // Default string/number comparison
      if (a[sortField] < b[sortField])
        return sortDirection === 'asc' ? -1 : 1;
      if (a[sortField] > b[sortField])
        return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [databases, sortField, sortDirection]);

  const handleSort = (field: keyof Database) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  return (
    <Card>
      <div className="p-6">
        <h3 className="text-xl font-semibold mb-4">
          Global Database Status Grid
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          All databases sorted by health status
        </p>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b">
              <tr>
                <th
                  className="text-left py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('name')}
                >
                  Database Name
                </th>
                <th
                  className="text-left py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('type')}
                >
                  Engine
                </th>
                <th
                  className="text-left py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('region')}
                >
                  Region
                </th>
                <th
                  className="text-left py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('cloud')}
                >
                  Cloud
                </th>
                <th
                  className="text-left py-3 px-4 font-semibold text-sm cursor-pointer hover:bg-muted/50"
                  onClick={() => handleSort('healthStatus')}
                >
                  Health Status
                </th>
                <th className="text-left py-3 px-4 font-semibold text-sm">
                  Stability Trend
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedDatabases.map((db) => (
                <tr
                  key={db.id}
                  className="border-b last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                  onClick={() => navigate(`/database/${db.id}`)}
                >
                  <td className="py-3 px-4">
                    <div className="font-medium">{db.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {db.environment}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <Badge variant="outline" className="uppercase text-xs">
                      {db.type}
                    </Badge>
                  </td>
                  <td className="py-3 px-4 text-sm">{db.region}</td>
                  <td className="py-3 px-4">
                    <Badge variant="outline" className="uppercase text-xs">
                      {db.cloud}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {getHealthIcon(db.healthStatus)}
                      </span>
                      <span
                        className={cn(
                          'text-sm font-medium capitalize',
                          db.healthStatus === 'critical' &&
                            'text-red-600 dark:text-red-400',
                          db.healthStatus === 'warning' &&
                            'text-yellow-600 dark:text-yellow-400',
                          (db.healthStatus === 'good' ||
                            db.healthStatus === 'excellent') &&
                            'text-green-600 dark:text-green-400'
                        )}
                      >
                        {db.healthStatus}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1">
                      {getTrendIcon(db.healthTrend)}
                      <span className="text-sm text-muted-foreground capitalize">
                        {db.healthTrend}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}
