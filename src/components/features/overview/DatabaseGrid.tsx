import { useNavigate } from 'react-router-dom';
import type { Database } from '@/types';
import { HealthBadge } from '@/components/common/HealthBadge';
import { formatCurrency } from '@/lib/formatters';
import { ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DatabaseGridProps {
  databases: Database[];
}

export function DatabaseGrid({ databases }: DatabaseGridProps) {
  const navigate = useNavigate();
  const getCloudBadgeColor = (cloud: string) => {
    const colors = {
      aws: 'bg-orange-100 text-orange-800 border-orange-200',
      gcp: 'bg-blue-100 text-blue-800 border-blue-200',
      azure: 'bg-sky-100 text-sky-800 border-sky-200',
    };
    return colors[cloud as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getEnvBadgeColor = (env: string) => {
    const colors = {
      production: 'bg-purple-100 text-purple-800 border-purple-200',
      staging: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      development: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    return colors[env as keyof typeof colors] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold">Name</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Type</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Cloud</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Region</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Environment</th>
              <th className="px-4 py-3 text-left text-sm font-semibold">Health</th>
              <th className="px-4 py-3 text-right text-sm font-semibold">Cost/mo</th>
              <th className="pl-4 pr-0 py-3 text-center text-sm font-semibold">Issues</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {databases.map((db) => (
              <tr
                key={db.id}
                onClick={() => navigate(`/databases/${db.id}`)}
                className="hover:bg-muted/50 transition-colors cursor-pointer"
              >
                {/* Name */}
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="font-medium">{db.name}</span>
                    <span className="text-xs text-muted-foreground">{db.id}</span>
                  </div>
                </td>

                {/* Type */}
                <td className="px-4 py-3">
                  <span className="text-sm capitalize">{db.type}</span>
                </td>

                {/* Cloud */}
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium',
                      getCloudBadgeColor(db.cloud)
                    )}
                  >
                    {db.cloud.toUpperCase()}
                  </span>
                </td>

                {/* Region */}
                <td className="px-4 py-3">
                  <span className="text-sm text-muted-foreground">{db.region}</span>
                </td>

                {/* Environment */}
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium capitalize',
                      getEnvBadgeColor(db.environment)
                    )}
                  >
                    {db.environment}
                  </span>
                </td>

                {/* Health */}
                <td className="px-4 py-3">
                  <HealthBadge status={db.healthStatus} score={db.healthScore} size="sm" />
                </td>

                {/* Cost */}
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-col items-end gap-1">
                    <span className="font-medium">{formatCurrency(db.monthlyCost)}</span>
                    <div className="flex items-center gap-1 text-xs">
                      {db.costTrend === 'up' && (
                        <>
                          <ArrowUp className="h-3 w-3 text-red-500" />
                          <span className="text-red-600">+12%</span>
                        </>
                      )}
                      {db.costTrend === 'down' && (
                        <>
                          <ArrowDown className="h-3 w-3 text-green-500" />
                          <span className="text-green-600">-8%</span>
                        </>
                      )}
                      {db.costTrend === 'stable' && (
                        <span className="text-muted-foreground">stable</span>
                      )}
                    </div>
                  </div>
                </td>

                {/* Issues */}
                <td className="pl-4 pr-0 py-3 text-center">
                  {db.activeIssues > 0 ? (
                    <div className="flex items-center justify-center gap-1">
                      <AlertCircle className="h-4 w-4 text-red-500" />
                      <span className="font-medium text-red-600">{db.activeIssues}</span>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
