import { useState, useMemo } from 'react';
import { CostSummaryCards } from '@/components/features/billing/CostSummaryCards';
import { CostTrendChart } from '@/components/features/billing/CostTrendChart';
import { CostAnomaliesList } from '@/components/features/billing/CostAnomaliesList';
import { CostBreakdownTable } from '@/components/features/billing/CostBreakdownTable';
import { CostDetailDialog } from '@/components/features/billing/CostDetailDialog';
import { mockData } from '@/data/mock-data';
import type { DatabaseCost, CostAnomaly } from '@/types';

type GroupBy = 'total' | 'cloud' | 'type';

export function BillingPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('cloud');
  const [selectedCost, setSelectedCost] = useState<DatabaseCost | null>(null);

  // Calculate summary statistics
  const summary = useMemo(() => {
    const { costs, timeSeries, anomalies } = mockData.billing;

    const totalCost = costs.reduce((sum, cost) => sum + cost.totalCost, 0);
    const averageCost = totalCost / costs.length;

    // Calculate trend (compare last vs first week average)
    const lastWeek = timeSeries.slice(-7);
    const firstWeek = timeSeries.slice(0, 7);
    const lastWeekAvg = lastWeek.reduce((sum, entry) => sum + entry.total, 0) / lastWeek.length;
    const firstWeekAvg = firstWeek.reduce((sum, entry) => sum + entry.total, 0) / firstWeek.length;
    const trendPercentage = ((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100;
    const trendDirection = trendPercentage > 5 ? 'up' : trendPercentage < -5 ? 'down' : 'stable';

    return {
      totalCost,
      averageCost,
      trendPercentage,
      trendDirection,
      anomalyCount: anomalies.length,
    };
  }, []);

  // Handle anomaly click - find the cost for that database
  const handleAnomalyClick = (anomaly: CostAnomaly) => {
    const cost = mockData.billing.costs.find((c) => c.databaseId === anomaly.databaseId);
    if (cost) {
      setSelectedCost(cost);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Billing & Cost Intelligence</h1>
        <p className="text-muted-foreground mt-1">
          Track and analyze database costs across your entire infrastructure
        </p>
      </div>

      {/* Summary Cards */}
      <CostSummaryCards
        totalCost={summary.totalCost}
        averageCostPerDatabase={summary.averageCost}
        trendPercentage={summary.trendPercentage}
        trendDirection={summary.trendDirection as 'up' | 'down' | 'stable'}
        anomalyCount={summary.anomalyCount}
      />

      {/* Cost Trend Chart */}
      <div className="rounded-lg border bg-card shadow-sm p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold">Cost Trend</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Last 30 days cost breakdown
            </p>
          </div>
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            className="px-3 py-2 border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="total">Total Cost</option>
            <option value="cloud">By Cloud Provider</option>
            <option value="type">By Database Type</option>
          </select>
        </div>
        <CostTrendChart data={mockData.billing.timeSeries} groupBy={groupBy} />
      </div>

      {/* Cost Anomalies */}
      {mockData.billing.anomalies.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Cost Anomalies</h2>
          <CostAnomaliesList
            anomalies={mockData.billing.anomalies}
            onAnomalyClick={handleAnomalyClick}
          />
        </div>
      )}

      {/* Cost Breakdown Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Cost Breakdown by Database</h2>
        <CostBreakdownTable
          costs={mockData.billing.costs}
          onRowClick={setSelectedCost}
        />
      </div>

      {/* Cost Detail Dialog */}
      {selectedCost && (
        <CostDetailDialog
          cost={selectedCost}
          onClose={() => setSelectedCost(null)}
        />
      )}
    </div>
  );
}
