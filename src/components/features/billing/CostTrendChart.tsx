import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/formatters';
import type { CostTimeSeries } from '@/types';

interface CostTrendChartProps {
  data: CostTimeSeries[];
  groupBy: 'cloud' | 'type' | 'total';
}

export function CostTrendChart({ data, groupBy }: CostTrendChartProps) {
  // Transform data for the chart
  const chartData = data.map((entry) => {
    const base = {
      date: format(entry.date, 'MMM d'),
      fullDate: entry.date,
    };

    if (groupBy === 'total') {
      return {
        ...base,
        Total: entry.total,
      };
    }

    if (groupBy === 'cloud') {
      return {
        ...base,
        AWS: entry.byCloud.aws || 0,
        GCP: entry.byCloud.gcp || 0,
        Azure: entry.byCloud.azure || 0,
      };
    }

    // groupBy === 'type'
    return {
      ...base,
      PostgreSQL: entry.byType.postgres || 0,
      MySQL: entry.byType.mysql || 0,
      MongoDB: entry.byType.mongodb || 0,
      Redis: entry.byType.redis || 0,
      DynamoDB: entry.byType.dynamodb || 0,
      Aurora: entry.byType.aurora || 0,
    };
  });

  // Define line colors
  const cloudColors = {
    AWS: '#f59e0b', // orange
    GCP: '#3b82f6', // blue
    Azure: '#0ea5e9', // sky
  };

  const typeColors = {
    PostgreSQL: '#8b5cf6', // purple
    MySQL: '#10b981', // green
    MongoDB: '#06b6d4', // cyan
    Redis: '#ef4444', // red
    DynamoDB: '#f59e0b', // amber
    Aurora: '#ec4899', // pink
  };

  const totalColors = {
    Total: '#3b82f6', // blue
  };

  const getLines = () => {
    if (groupBy === 'total') {
      return Object.keys(totalColors).map((key) => ({
        key,
        color: totalColors[key as keyof typeof totalColors],
      }));
    }

    if (groupBy === 'cloud') {
      return Object.keys(cloudColors).map((key) => ({
        key,
        color: cloudColors[key as keyof typeof cloudColors],
      }));
    }

    // type
    return Object.keys(typeColors).map((key) => ({
      key,
      color: typeColors[key as keyof typeof typeColors],
    }));
  };

  const lines = getLines();

  return (
    <div className="w-full h-[400px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="date"
            className="text-xs"
            tick={{ fill: 'currentColor' }}
          />
          <YAxis
            className="text-xs"
            tick={{ fill: 'currentColor' }}
            tickFormatter={(value) => formatCurrency(value)}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'hsl(var(--background))',
              border: '1px solid hsl(var(--border))',
              borderRadius: '0.5rem',
            }}
            labelStyle={{ color: 'hsl(var(--foreground))' }}
            formatter={(value) => [formatCurrency(value as number), '']}
          />
          <Legend
            wrapperStyle={{ paddingTop: '20px' }}
            iconType="line"
          />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              stroke={line.color}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
