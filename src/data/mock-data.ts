import type { Database, Issue, DatabaseCost, CostAnomaly, Alert } from '@/types';
import { generateDatabases } from './generators/database-generator';
import { generateIssues } from './generators/issues-generator';
import {
  generateDatabaseCosts,
  generateCostAnomalies,
  generateCostTimeSeries,
} from './generators/billing-generator';
import { generateAlerts } from './generators/alert-generator';

// Generate all mock data once
const databases = generateDatabases(50);
const issues = generateIssues(databases);
const costs = generateDatabaseCosts(databases);
const anomalies = generateCostAnomalies(databases, costs);
const costTimeSeries = generateCostTimeSeries(databases, 30);
const alerts = generateAlerts(databases);

// Export consolidated mock data
export const mockData = {
  databases,
  issues,
  alerts,
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

export function getAlertsByDatabaseId(databaseId: string): Alert[] {
  return alerts.filter(alert => alert.databaseId === databaseId);
}

// Export individual datasets for direct access
export { databases, issues, costs, anomalies, costTimeSeries, alerts };
