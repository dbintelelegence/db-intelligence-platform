import { useState, useMemo } from 'react';
import { CostSummaryCards } from '@/components/features/billing/CostSummaryCards';
import { CostTrendChart } from '@/components/features/billing/CostTrendChart';
import { CostAnomaliesList } from '@/components/features/billing/CostAnomaliesList';
import { CostBreakdownTable } from '@/components/features/billing/CostBreakdownTable';
import { CostDetailDialog } from '@/components/features/billing/CostDetailDialog';
import { useBillingData } from '@/hooks/useApi';
import type { DatabaseCost, CostAnomaly } from '@/types';
import { Loader2 } from 'lucide-react';

type GroupBy = 'total' | 'cloud' | 'type';

export function BillingPage() {
  const [groupBy, setGroupBy] = useState<GroupBy>('cloud');
  const [selectedCost, setSelectedCost] = useState<DatabaseCost | null>(null);

  // Fetch billing data from API
  const { summary: billingSummary, costs, timeSeries, anomalies, isLoading, error } = useBillingData();

  // Calculate summary statistics from API data
  const summary = useMemo(() => {
    if (!billingSummary) {
      return {
        totalCost: 0,
        averageCost: 0,
        trendPercentage: 0,
        trendDirection: 'stable' as const,
        anomalyCount: 0,
      };
    }

    const totalCost = billingSummary.totalCost;
    const averageCost = costs.length > 0 ? totalCost / costs.length : 0;
    const trendPercentage = billingSummary.costChangePercent;
    const trendDirection = trendPercentage > 5 ? 'up' : trendPercentage < -5 ? 'down' : 'stable';

    return {
      totalCost,
      averageCost,
      trendPercentage,
      trendDirection,
      anomalyCount: anomalies.length,
    };
  }, [billingSummary, costs, anomalies]);

  // Handle anomaly click - find the cost for that database
  const handleAnomalyClick = (anomaly: CostAnomaly) => {
    const cost = costs.find((c) => c.databaseId === anomaly.databaseId);
    if (cost) {
      setSelectedCost(cost);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading billing data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6">
        <h2 className="text-lg font-semibold text-destructive">Error loading billing data</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Unable to connect to the backend API. Make sure the server is running.
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Error: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
      </div>
    );
  }

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
        <CostTrendChart data={timeSeries} groupBy={groupBy} />
      </div>

      {/* Cost Anomalies */}
      {anomalies.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Cost Anomalies</h2>
          <CostAnomaliesList
            anomalies={anomalies}
            onAnomalyClick={handleAnomalyClick}
          />
        </div>
      )}

      {/* Cost Breakdown Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Cost Breakdown by Database</h2>
        <CostBreakdownTable
          costs={costs}
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
