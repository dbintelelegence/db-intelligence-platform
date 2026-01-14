import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Cloud, MapPin, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import type { Database } from '@/types';
import type { TimeRange, TimeRangeOption } from '@/hooks/useTimeRange';

interface DatabaseHeaderProps {
  database: Database;
  timeRange: TimeRange;
  onTimeRangeChange: (option: TimeRangeOption) => void;
}

export function DatabaseHeader({
  database,
  timeRange,
  onTimeRangeChange,
}: DatabaseHeaderProps) {
  const navigate = useNavigate();

  const getEnvBadgeColor = (env: string) => {
    const colors = {
      production: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300',
      staging: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900/30 dark:text-yellow-300',
      development: 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-800/50 dark:text-gray-300',
    };
    return colors[env as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getCloudIcon = () => {
    return <Cloud className="h-3.5 w-3.5" />;
  };

  const getCloudColor = (cloud: string) => {
    const colors = {
      aws: 'text-orange-600 dark:text-orange-400',
      gcp: 'text-blue-600 dark:text-blue-400',
      azure: 'text-sky-600 dark:text-sky-400',
    };
    return colors[cloud as keyof typeof colors] || 'text-gray-600';
  };

  return (
    <div className="space-y-4">
      {/* Back Button */}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/databases')}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Databases
        </Button>
      </div>

      {/* Header Content */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-3">
          {/* Database Name */}
          <h1 className="text-3xl font-bold tracking-tight">{database.name}</h1>

          {/* Metadata Pills */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Cloud Provider */}
            <div className={cn('flex items-center gap-1.5 text-sm font-medium', getCloudColor(database.cloud))}>
              {getCloudIcon()}
              <span>{database.cloud.toUpperCase()}</span>
            </div>

            <span className="text-muted-foreground">·</span>

            {/* Region */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" />
              <span>{database.region}</span>
            </div>

            <span className="text-muted-foreground">·</span>

            {/* Database Type */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Server className="h-3.5 w-3.5" />
              <span className="capitalize">{database.type}</span>
            </div>

            <span className="text-muted-foreground">·</span>

            {/* Environment Badge */}
            <Badge
              variant="outline"
              className={cn('capitalize', getEnvBadgeColor(database.environment))}
            >
              {database.environment}
            </Badge>
          </div>

          {/* Last Checked */}
          <p className="text-sm text-muted-foreground">
            Last checked {formatDistanceToNow(database.lastChecked, { addSuffix: true })}
          </p>
        </div>

        {/* Time Range Picker */}
        <div className="flex-shrink-0">
          <Select
            value={timeRange.value}
            onValueChange={(value) => onTimeRangeChange(value as TimeRangeOption)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1h">Last hour</SelectItem>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
