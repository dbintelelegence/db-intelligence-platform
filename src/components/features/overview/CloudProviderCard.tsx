import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CloudAggregate } from '@/utils/aggregation';
import { getCloudBorderColor, formatCurrency } from '@/utils/aggregation';
import { CloudIcon } from './CloudIcon';
import { SeverityBadge } from './SeverityBadge';
import { HealthProgressBar } from './HealthProgressBar';
import { Stat } from './Stat';
import { RegionCard } from './RegionCard';

interface CloudProviderCardProps {
  cloudAggregate: CloudAggregate;
  defaultExpanded?: boolean;
}

export function CloudProviderCard({ cloudAggregate, defaultExpanded = false }: CloudProviderCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <Card
      className={cn(
        'p-6 border-2 transition-all',
        getCloudBorderColor(cloudAggregate.cloud),
        cloudAggregate.criticalCount > 0 && 'border-red-500 shadow-lg'
      )}
    >
      {/* Header: Cloud name, icon, severity badge */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <CloudIcon cloud={cloudAggregate.cloud} />
          <h3 className="text-xl font-semibold">{cloudAggregate.cloud.toUpperCase()}</h3>
        </div>
        <SeverityBadge
          critical={cloudAggregate.criticalCount}
          warning={cloudAggregate.warningCount}
        />
      </div>

      {/* Summary line */}
      <p className="text-sm text-muted-foreground mb-4">
        {cloudAggregate.databaseCount} database{cloudAggregate.databaseCount !== 1 ? 's' : ''} •{' '}
        {cloudAggregate.healthyCount} healthy •{' '}
        {cloudAggregate.warningCount} warning •{' '}
        {cloudAggregate.criticalCount} critical
      </p>

      {/* Summary metrics */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <Stat label="Databases" value={cloudAggregate.databaseCount} />
        <Stat label="Healthy" value={cloudAggregate.healthyCount} />
        <Stat label="Monthly Cost" value={formatCurrency(cloudAggregate.monthlyCost)} />
      </div>

      {/* Health progress bar */}
      <div className="mb-4">
        <HealthProgressBar healthScore={cloudAggregate.avgHealthScore} />
      </div>

      {/* Expand/collapse button */}
      <Button
        variant="ghost"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full justify-center gap-2"
      >
        {isExpanded ? (
          <>
            <ChevronDown className="h-4 w-4" />
            Hide Regions
          </>
        ) : (
          <>
            <ChevronRight className="h-4 w-4" />
            Show {cloudAggregate.regions.length} Region
            {cloudAggregate.regions.length !== 1 ? 's' : ''}
          </>
        )}
      </Button>

      {/* Expandable region list */}
      {isExpanded && (
        <div className="mt-4 space-y-3">
          {cloudAggregate.regions.map((region) => (
            <RegionCard key={region.region} regionAggregate={region} />
          ))}
        </div>
      )}
    </Card>
  );
}
