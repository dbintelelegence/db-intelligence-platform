import { X, TrendingUp, TrendingDown, Minus, DollarSign } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { formatCurrency, formatPercent } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { DatabaseCost } from '@/types';

interface CostDetailDialogProps {
  cost: DatabaseCost;
  onClose: () => void;
}

export function CostDetailDialog({ cost, onClose }: CostDetailDialogProps) {
  // Prepare data for pie chart
  const chartData = [
    { name: 'Compute', value: cost.breakdown.compute, color: '#3b82f6' },
    { name: 'Storage', value: cost.breakdown.storage, color: '#8b5cf6' },
    { name: 'Backup', value: cost.breakdown.backup, color: '#10b981' },
    { name: 'Transfer', value: cost.breakdown.dataTransfer, color: '#f59e0b' },
    { name: 'Other', value: cost.breakdown.other, color: '#6b7280' },
  ].filter((item) => item.value > 0);

  const getTrendIcon = () => {
    if (cost.trend.direction === 'up') return TrendingUp;
    if (cost.trend.direction === 'down') return TrendingDown;
    return Minus;
  };

  const getTrendColor = () => {
    if (cost.trend.direction === 'up') return 'text-red-600 dark:text-red-400';
    if (cost.trend.direction === 'down') return 'text-green-600 dark:text-green-400';
    return 'text-muted-foreground';
  };

  const TrendIcon = getTrendIcon();

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-background rounded-lg shadow-xl max-w-4xl w-full my-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 border-b">
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-1">{cost.databaseName}</h2>
            <p className="text-muted-foreground">Detailed Cost Breakdown</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-2 hover:bg-muted rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">Total Monthly Cost</p>
              <p className="text-2xl font-bold">{formatCurrency(cost.totalCost)}</p>
            </div>
            <div className="bg-muted/30 border rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">Cost Trend</p>
              <div className="flex items-center gap-2">
                <TrendIcon className={cn('h-5 w-5', getTrendColor())} />
                <p className={cn('text-2xl font-bold', getTrendColor())}>
                  {cost.trend.direction === 'stable' ? 'Stable' : formatPercent(Math.abs(cost.trend.change))}
                </p>
              </div>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
              <p className="text-sm text-muted-foreground mb-1">Next Month Forecast</p>
              <p className="text-2xl font-bold">{formatCurrency(cost.forecast.nextMonth)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {cost.forecast.confidence}% confidence
              </p>
            </div>
          </div>

          {/* Pie Chart and Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart */}
            <div>
              <h3 className="font-semibold text-lg mb-4">Cost Distribution</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${percent ? (percent * 100).toFixed(0) : 0}%`}
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.5rem',
                      }}
                      formatter={(value) => formatCurrency(value as number)}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Detailed Breakdown */}
            <div>
              <h3 className="font-semibold text-lg mb-4">Cost Components</h3>
              <div className="space-y-3">
                <CostItem
                  label="Compute"
                  amount={cost.breakdown.compute}
                  total={cost.totalCost}
                  color="bg-blue-500"
                />
                <CostItem
                  label="Storage"
                  amount={cost.breakdown.storage}
                  total={cost.totalCost}
                  color="bg-purple-500"
                />
                <CostItem
                  label="Backup"
                  amount={cost.breakdown.backup}
                  total={cost.totalCost}
                  color="bg-green-500"
                />
                <CostItem
                  label="Data Transfer"
                  amount={cost.breakdown.dataTransfer}
                  total={cost.totalCost}
                  color="bg-amber-500"
                />
                {cost.breakdown.other > 0 && (
                  <CostItem
                    label="Other"
                    amount={cost.breakdown.other}
                    total={cost.totalCost}
                    color="bg-gray-500"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Forecast Details */}
          <div className="bg-muted/30 border rounded-lg p-4">
            <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Forecast Analysis
            </h3>
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                Based on current usage patterns and historical trends, we forecast your next month's cost
                to be approximately <span className="font-semibold text-foreground">{formatCurrency(cost.forecast.nextMonth)}</span>.
              </p>
              <p className="text-muted-foreground">
                This prediction has a <span className="font-semibold text-foreground">{cost.forecast.confidence}%</span> confidence level.
                {cost.trend.direction === 'up' && (
                  <span className="text-red-600 dark:text-red-400 font-medium">
                    {' '}Note: Your costs are trending upward, consider reviewing resource utilization.
                  </span>
                )}
                {cost.trend.direction === 'down' && (
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    {' '}Good news: Your costs are trending downward!
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border hover:bg-muted transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

interface CostItemProps {
  label: string;
  amount: number;
  total: number;
  color: string;
}

function CostItem({ label, amount, total, color }: CostItemProps) {
  const percentage = (amount / total) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn('w-3 h-3 rounded-full', color)} />
          <span className="text-sm font-medium">{label}</span>
        </div>
        <div className="text-right">
          <span className="font-semibold">{formatCurrency(amount)}</span>
          <span className="text-xs text-muted-foreground ml-2">
            ({percentage.toFixed(1)}%)
          </span>
        </div>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full', color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
