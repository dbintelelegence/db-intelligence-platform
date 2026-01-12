import type { Database, Issue, DatabaseCost, CostAnomaly } from '@/types';
import { generateDatabases } from './generators/database-generator';
import { generateIssues } from './generators/issues-generator';
import {
  generateDatabaseCosts,
  generateCostAnomalies,
  generateCostTimeSeries,
} from './generators/billing-generator';

// Generate all mock data once
const databases = generateDatabases(50);
const issues = generateIssues(databases);
const costs = generateDatabaseCosts(databases);
const anomalies = generateCostAnomalies(databases, costs);
const costTimeSeries = generateCostTimeSeries(databases, 30);

// Export consolidated mock data
export const mockData = {
  databases,
  issues,
  billing: {
    costs,
    anomalies,
    timeSeries: costTimeSeries,
  },
};

// Helper functions to query data
export function getDatabaseById(id: string): Database | undefined {
  return databases.find(db => db.id === id);
}

export function getIssuesByDatabaseId(databaseId: string): Issue[] {
  return issues.filter(issue => issue.databaseId === databaseId);
}

export function getCostByDatabaseId(databaseId: string): DatabaseCost | undefined {
  return costs.find(cost => cost.databaseId === databaseId);
}

export function getAnomaliesByDatabaseId(databaseId: string): CostAnomaly[] {
  return anomalies.filter(anomaly => anomaly.databaseId === databaseId);
}

// Export individual datasets for direct access
export { databases, issues, costs, anomalies, costTimeSeries };
