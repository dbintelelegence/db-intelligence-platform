import { Database, Activity, AlertTriangle, DollarSign } from 'lucide-react';
import { MetricCard } from '@/components/common/MetricCard';
import { formatCurrency } from '@/lib/formatters';

interface ExecutiveSummaryProps {
  totalDatabases: number;
  healthyDatabases: number;
  warningDatabases: number;
  criticalDatabases: number;
  totalCost: number;
  activeIssues: number;
}

export function ExecutiveSummary({
  totalDatabases,
  healthyDatabases,
  warningDatabases,
  criticalDatabases,
  totalCost,
  activeIssues,
}: ExecutiveSummaryProps) {
  // Calculate health percentage
  const healthPercentage = totalDatabases > 0
    ? Math.round((healthyDatabases / totalDatabases) * 100)
    : 0;

  // Determine overall status message
  const getStatusMessage = () => {
    if (criticalDatabases > 0) {
      return `${criticalDatabases} ${criticalDatabases === 1 ? 'database' : 'databases'} require immediate attention`;
    }
    if (warningDatabases > 0) {
      return `${warningDatabases} ${warningDatabases === 1 ? 'database has' : 'databases have'} warnings`;
    }
    return 'All databases are healthy and stable';
  };

  return (
    <div className="space-y-4">
      {/* Status Message */}
      <div className="rounded-lg border bg-card p-4">
        <p className="text-lg font-semibold">
          {getStatusMessage()}
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {healthPercentage}% of databases are operating normally
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Databases"
          value={totalDatabases}
          icon={Database}
          iconColor="text-blue-500"
        />

        <MetricCard
          label="Healthy"
          value={healthyDatabases}
          icon={Activity}
          iconColor="text-green-500"
          trendValue={`${healthPercentage}%`}
        />

        <MetricCard
          label="Active Issues"
          value={activeIssues}
          icon={AlertTriangle}
          iconColor={activeIssues > 0 ? 'text-red-500' : 'text-gray-400'}
        />

        <MetricCard
          label="Monthly Cost"
          value={formatCurrency(totalCost)}
          icon={DollarSign}
          iconColor="text-amber-500"
        />
      </div>
    </div>
  );
}
