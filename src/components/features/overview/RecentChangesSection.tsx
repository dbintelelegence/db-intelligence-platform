import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/ui/card';
import { Settings, Activity, Wrench, Clock } from 'lucide-react';
import type { Database } from '@/types';

interface RecentChangesSectionProps {
  databases: Database[];
}

interface Change {
  id: string;
  type: 'config' | 'resize' | 'maintenance';
  description: string;
  database: Database;
  timestamp: string;
  impact?: string;
}

function generateRecentChanges(databases: Database[]): Change[] {
  const changes: Change[] = [];

  // Generate some realistic changes based on database data
  databases.slice(0, 10).forEach((db, index) => {
    if (db.recentChanges > 0) {
      // Vary the change types
      if (index % 3 === 0) {
        changes.push({
          id: `${db.id}-config`,
          type: 'config',
          description: `Parameter group updated on ${db.name}`,
          database: db,
          timestamp:
            index === 0
              ? '2 hours ago'
              : index === 1
                ? 'yesterday'
                : '3 days ago',
          impact:
            db.healthStatus === 'critical' || db.healthStatus === 'warning'
              ? 'May be correlated with current issues'
              : undefined,
        });
      } else if (index % 3 === 1) {
        changes.push({
          id: `${db.id}-resize`,
          type: 'resize',
          description: `Instance resized on ${db.name}`,
          database: db,
          timestamp:
            index < 3 ? 'yesterday' : index < 6 ? '2 days ago' : '4 days ago',
        });
      } else {
        changes.push({
          id: `${db.id}-maintenance`,
          type: 'maintenance',
          description: `Maintenance event completed on ${db.name}`,
          database: db,
          timestamp: '3 days ago',
        });
      }
    }
  });

  // Limit to 4 most recent
  return changes.slice(0, 4);
}

function getChangeIcon(type: Change['type']) {
  switch (type) {
    case 'config':
      return <Settings className="h-4 w-4" />;
    case 'resize':
      return <Activity className="h-4 w-4" />;
    case 'maintenance':
      return <Wrench className="h-4 w-4" />;
  }
}

export function RecentChangesSection({ databases }: RecentChangesSectionProps) {
  const navigate = useNavigate();
  const changes = useMemo(
    () => generateRecentChanges(databases),
    [databases]
  );

  if (changes.length === 0) {
    return null; // Don't show section if no changes
  }

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h3 className="text-xl font-semibold">What changed recently</h3>
        <p className="text-sm text-muted-foreground">
          Recent changes that may affect stability
        </p>
      </div>

      <div className="space-y-3">
        {changes.map((change) => (
          <div
            key={change.id}
            className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors"
            onClick={() => navigate(`/database/${change.database.id}`)}
          >
            {/* Icon */}
            <div className="mt-0.5 text-muted-foreground">
              {getChangeIcon(change.type)}
            </div>

            {/* Content */}
            <div className="flex-1">
              <div className="flex items-start justify-between">
                <p className="text-sm font-medium">{change.description}</p>
                <div className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap ml-2">
                  <Clock className="h-3 w-3" />
                  {change.timestamp}
                </div>
              </div>

              {change.impact && (
                <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                  ⚠ {change.impact}
                </p>
              )}

              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                  {change.database.cloud.toUpperCase()}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
                  {change.database.region}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
