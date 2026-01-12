import type { CloudProvider, DatabaseType, Trend } from './database';

export interface CostBreakdown {
  compute: number;          // USD
  storage: number;          // USD
  backup: number;           // USD
  dataTransfer: number;     // USD
  other: number;            // USD
}

export interface CostTrend {
  change: number;           // Percentage change
  direction: Trend;
}

export interface CostForecast {
  nextMonth: number;        // Predicted cost for next month (USD)
  confidence: number;       // Confidence percentage (0-100)
}

export interface DatabaseCost {
  databaseId: string;
  databaseName: string;
  totalCost: number;        // USD
  breakdown: CostBreakdown;
  trend: CostTrend;
  forecast: CostForecast;
}

export interface CostAnomaly {
  id: string;
  databaseId: string;
  databaseName: string;
  detectedAt: Date;
  type: 'spike' | 'sustained_increase' | 'unexpected_charge';
  amount: number;           // Anomalous amount (USD)
  baseline: number;         // Expected amount (USD)
  explanation: string;      // AI-generated explanation
  possibleCauses: string[];
}

export interface CostTimeSeries {
  date: Date;
  total: number;
  byCloud: Record<CloudProvider, number>;
  byType: Record<DatabaseType, number>;
  byRegion: Record<string, number>;
}
