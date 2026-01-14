import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { generateMetricsTimeSeries } from '@/data/generators/metrics-time-series-generator';
import { Cpu, MemoryStick, HardDrive, Users, Zap, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Database } from '@/types';
import type { TimeRange } from '@/hooks/useTimeRange';

interface MetricsTabProps {
  database: Database;
  timeRange: TimeRange;
}

interface MetricChartProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  data: Array<{ timestamp: Date; value: number }>;
  currentValue: number;
  unit: string;
  color: string;
  threshold?: number;
  formatValue?: (value: number) => string;
}

function MetricChart({
  title,
  icon: Icon,
  data,
  currentValue,
  unit,
  color,
  threshold,
  formatValue = (v) => v.toFixed(1),
}: MetricChartProps) {
  const chartData = data.map((point) => ({
    time: format(point.timestamp, 'HH:mm'),
    value: point.value,
  }));

  const average = data.reduce((sum, point) => sum + point.value, 0) / data.length;
  const peak = Math.max(...data.map((point) => point.value));

  const isWarning = threshold && currentValue >= threshold * 0.85;
  const isCritical = threshold && currentValue >= threshold;

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={cn('rounded-lg p-2', `bg-${color}-100 dark:bg-${color}-900/30`)}>
            <Icon className={cn('h-4 w-4', `text-${color}-600 dark:text-${color}-400`)} />
          </div>
          <h3 className="font-semibold">{title}</h3>
        </div>
      </div>

      <div className="space-y-4">
        {/* Current Value */}
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                'text-3xl font-bold',
                isCritical && 'text-red-600 dark:text-red-400',
                isWarning && !isCritical && 'text-yellow-600 dark:text-yellow-400'
              )}
            >
              {formatValue(currentValue)}
            </span>
            <span className="text-sm text-muted-foreground">{unit}</span>
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
            <span>Avg: {formatValue(average)}{unit}</span>
            <span>Peak: {formatValue(peak)}{unit}</span>
          </div>
        </div>

        {/* Chart */}
        <div className="h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={35}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.5rem',
                  fontSize: '12px',
                }}
                formatter={(value) => [formatValue(value as number) + unit, title]}
              />
              {threshold && (
                <ReferenceLine
                  y={threshold}
                  stroke="hsl(var(--destructive))"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke={`hsl(var(--${color}))`}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Card>
  );
}

export function MetricsTab({ database, timeRange }: MetricsTabProps) {
  const metricsData = useMemo(() => {
    return generateMetricsTimeSeries(database, timeRange);
  }, [database, timeRange]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* CPU Usage */}
        <MetricChart
          title="CPU Usage"
          icon={Cpu}
          data={metricsData.cpu}
          currentValue={database.metrics.cpu}
          unit="%"
          color="orange"
          threshold={80}
        />

        {/* Memory Usage */}
        <MetricChart
          title="Memory Usage"
          icon={MemoryStick}
          data={metricsData.memory}
          currentValue={database.metrics.memory}
          unit="%"
          color="blue"
          threshold={80}
        />

        {/* Storage Usage */}
        <MetricChart
          title="Storage Usage"
          icon={HardDrive}
          data={metricsData.storage}
          currentValue={database.metrics.storage}
          unit="%"
          color="purple"
          threshold={80}
        />

        {/* Connections */}
        <MetricChart
          title="Active Connections"
          icon={Users}
          data={metricsData.connections}
          currentValue={database.metrics.connections}
          unit={` / ${database.metrics.maxConnections}`}
          color="green"
          threshold={database.metrics.maxConnections * 0.9}
          formatValue={(v) => Math.round(v).toString()}
        />

        {/* Latency */}
        <MetricChart
          title="Query Latency"
          icon={Zap}
          data={metricsData.latency}
          currentValue={database.metrics.latency}
          unit="ms"
          color="yellow"
          threshold={100}
        />

        {/* Throughput */}
        <MetricChart
          title="Throughput"
          icon={Activity}
          data={metricsData.throughput}
          currentValue={database.metrics.throughput}
          unit=" qps"
          color="cyan"
          formatValue={(v) => Math.round(v).toString()}
        />
      </div>

      {/* Info Card */}
      <Card className="p-4 bg-muted/50">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold">Note:</span> Charts display data for the selected time range.
          Threshold lines (dashed) indicate warning levels at 80% capacity for CPU, Memory, and Storage.
        </p>
      </Card>
    </div>
  );
}
