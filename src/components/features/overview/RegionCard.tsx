import { useNavigate } from 'react-router-dom';
import { MapPin, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { RegionAggregate } from '@/utils/aggregation';
import { formatCurrency } from '@/utils/aggregation';
import { HealthProgressBar } from './HealthProgressBar';

interface RegionCardProps {
  regionAggregate: RegionAggregate;
}

export function RegionCard({ regionAggregate }: RegionCardProps) {
  const navigate = useNavigate();

  return (
    <Card className="p-4 bg-muted/30 hover:bg-muted/50 transition-colors">
      {/* Region header with stats */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span className="font-semibold">{regionAggregate.region}</span>
            <span className="text-sm text-muted-foreground">
              • {regionAggregate.databaseCount} DB{regionAggregate.databaseCount !== 1 ? 's' : ''}
            </span>
            {regionAggregate.criticalCount > 0 && (
              <Badge variant="destructive" className="text-xs">
                {regionAggregate.criticalCount} critical
              </Badge>
            )}
            {regionAggregate.warningCount > 0 && (
              <Badge className="text-xs bg-yellow-500 hover:bg-yellow-600 text-white">
                {regionAggregate.warningCount} warning
              </Badge>
            )}
          </div>
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            navigate(`/databases?cloud=${regionAggregate.cloud}&region=${regionAggregate.region}`)
          }
        >
          View
        </Button>
      </div>

      {/* Health bar and cost */}
      <div className="flex items-center gap-4 mb-3">
        <div className="flex-1">
          <HealthProgressBar healthScore={regionAggregate.avgHealthScore} size="sm" />
        </div>
        <div className="text-sm text-muted-foreground whitespace-nowrap">
          {formatCurrency(regionAggregate.monthlyCost)}/mo
        </div>
      </div>

      {/* Problem highlights */}
      {regionAggregate.topIssues.length > 0 && (
        <div className="mt-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-md border border-yellow-200 dark:border-yellow-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 flex-shrink-0" />
            <div className="text-sm flex-1">
              <div className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                Issues:
              </div>
              <ul className="text-yellow-700 dark:text-yellow-300 space-y-1">
                {regionAggregate.topIssues.slice(0, 2).map((issue, i) => (
                  <li key={i}>• {issue}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
