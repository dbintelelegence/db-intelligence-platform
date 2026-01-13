import { mockData } from '@/data/mock-data';
import type {
  SummarizationRequest,
  SummarizationResponse,
  TimeWindow,
  SummarizationContext
} from '@/types/summarization';
import type { Database, Issue } from '@/types';
import { callLLM, parseLLMResponse } from './llm-service';

/**
 * Calculates the time range based on the selected window
 */
function getTimeRange(window: TimeWindow): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();

  switch (window) {
    case '1h':
      start.setHours(start.getHours() - 1);
      break;
    case '6h':
      start.setHours(start.getHours() - 6);
      break;
    case '24h':
      start.setHours(start.getHours() - 24);
      break;
    case '7d':
      start.setDate(start.getDate() - 7);
      break;
    case '30d':
      start.setDate(start.getDate() - 30);
      break;
  }

  return { start, end };
}

/**
 * Filters data based on time window
 */
function filterDataByTimeWindow(context: SummarizationContext): SummarizationContext {
  const { start, end } = context.timeRange;

  // Filter issues within time range
  const filteredIssues = context.issues.filter((issue: Issue) => {
    const detectedAt = new Date(issue.detectedAt);
    return detectedAt >= start && detectedAt <= end;
  });

  return {
    ...context,
    issues: filteredIssues,
  };
}

/**
 * Analyzes database health and generates insights
 */
function analyzeHealth(databases: Database[]): string[] {
  const insights: string[] = [];

  const criticalDbs = databases.filter(db => db.healthStatus === 'critical');
  const warningDbs = databases.filter(db => db.healthStatus === 'warning');

  if (criticalDbs.length > 0) {
    insights.push(`${criticalDbs.length} database(s) in critical state requiring immediate attention`);
  }

  if (warningDbs.length > 0) {
    insights.push(`${warningDbs.length} database(s) showing warning signs that should be monitored`);
  }

  // Check for high resource usage
  const highCpu = databases.filter(db => db.metrics.cpu > 80);
  if (highCpu.length > 0) {
    insights.push(`${highCpu.length} database(s) experiencing high CPU usage (>80%)`);
  }

  const highMemory = databases.filter(db => db.metrics.memory > 80);
  if (highMemory.length > 0) {
    insights.push(`${highMemory.length} database(s) with high memory utilization (>80%)`);
  }

  const highStorage = databases.filter(db => db.metrics.storage > 80);
  if (highStorage.length > 0) {
    insights.push(`${highStorage.length} database(s) running low on storage space (>80% used)`);
  }

  return insights;
}

/**
 * Analyzes issues and generates insights
 */
function analyzeIssues(issues: Issue[]): { insights: string[]; recommendations: string[] } {
  const insights: string[] = [];
  const recommendations: string[] = [];

  const criticalIssues = issues.filter(i => i.severity === 'critical');
  const warningIssues = issues.filter(i => i.severity === 'warning');

  if (criticalIssues.length > 0) {
    insights.push(`${criticalIssues.length} critical issue(s) detected across monitored databases`);
    recommendations.push('Address critical issues immediately to prevent service disruption');
  }

  if (warningIssues.length > 0) {
    insights.push(`${warningIssues.length} warning-level issue(s) requiring attention`);
  }

  // Group by category
  const categoryGroups = issues.reduce((acc, issue) => {
    acc[issue.category] = (acc[issue.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const topCategory = Object.entries(categoryGroups)
    .sort(([, a], [, b]) => b - a)[0];

  if (topCategory) {
    insights.push(`Most common issue category: ${topCategory[0]} (${topCategory[1]} occurrences)`);
  }

  return { insights, recommendations };
}

/**
 * Generates recommendations based on context
 */
function generateRecommendations(context: SummarizationContext): string[] {
  const recommendations: string[] = [];

  // Check for connection pool issues
  const connectionIssues = context.databases.filter(db =>
    db.metrics.connections / db.metrics.maxConnections > 0.8
  );

  if (connectionIssues.length > 0) {
    recommendations.push(`Consider increasing connection pool limits for ${connectionIssues.length} database(s) approaching capacity`);
  }

  // Check for performance issues
  const slowDbs = context.databases.filter(db => db.metrics.latency > 100);
  if (slowDbs.length > 0) {
    recommendations.push(`Investigate query performance on ${slowDbs.length} database(s) with high latency (>100ms)`);
  }

  // Check for storage issues
  const storageDbs = context.databases.filter(db => db.metrics.storage > 85);
  if (storageDbs.length > 0) {
    recommendations.push(`Plan storage expansion for ${storageDbs.length} database(s) approaching capacity limits`);
  }

  // Check for unresolved issues
  const unresolvedIssues = context.issues.filter((i: Issue) => i.status === 'active' || i.status === 'acknowledged');
  if (unresolvedIssues.length > 0) {
    recommendations.push(`${unresolvedIssues.length} unresolved issue(s) require investigation and remediation`);
  }

  return recommendations;
}

/**
 * Creates a natural language summary based on the context and prompt
 */
function generateSummary(context: SummarizationContext, prompt: string): string {
  const { databases, issues, timeRange } = context;

  const windowText = formatTimeWindow(timeRange);
  const healthyDbs = databases.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good');
  const problemDbs = databases.filter(db => db.healthStatus === 'critical' || db.healthStatus === 'warning');

  const criticalIssues = issues.filter((i: Issue) => i.severity === 'critical');

  let summary = `Over the past ${windowText}, your database infrastructure shows:\n\n`;

  summary += `• ${healthyDbs.length}/${databases.length} databases operating normally\n`;

  if (problemDbs.length > 0) {
    summary += `• ${problemDbs.length} database(s) require attention\n`;
  }

  if (criticalIssues.length > 0) {
    summary += `• ${criticalIssues.length} critical issue(s) detected\n`;
  }

  summary += `\n`;

  // Add prompt-specific context
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('performance') || lowerPrompt.includes('slow')) {
    const slowDbs = databases.filter(db => db.metrics.latency > 100);
    summary += `Performance Analysis: ${slowDbs.length} database(s) experiencing elevated latency. `;
    summary += `Average response time across all databases is ${Math.round(databases.reduce((sum, db) => sum + db.metrics.latency, 0) / databases.length)}ms.`;
  } else if (lowerPrompt.includes('cost') || lowerPrompt.includes('billing')) {
    const totalCost = databases.reduce((sum, db) => sum + db.monthlyCost, 0);
    summary += `Cost Analysis: Current monthly spend across all databases is $${totalCost.toFixed(2)}. `;
    const increasingCost = databases.filter(db => db.costTrend === 'up').length;
    if (increasingCost > 0) {
      summary += `${increasingCost} database(s) showing cost increases.`;
    }
  } else if (lowerPrompt.includes('resource') || lowerPrompt.includes('cpu') || lowerPrompt.includes('memory')) {
    const avgCpu = Math.round(databases.reduce((sum, db) => sum + db.metrics.cpu, 0) / databases.length);
    const avgMemory = Math.round(databases.reduce((sum, db) => sum + db.metrics.memory, 0) / databases.length);
    summary += `Resource Utilization: Average CPU usage is ${avgCpu}%, memory at ${avgMemory}%. `;
    const highResource = databases.filter(db => db.metrics.cpu > 80 || db.metrics.memory > 80).length;
    if (highResource > 0) {
      summary += `${highResource} database(s) experiencing high resource pressure.`;
    }
  } else {
    summary += `Overall system health is ${problemDbs.length === 0 ? 'stable' : 'showing signs of degradation'} with ${issues.length} total issue(s) tracked.`;
  }

  return summary;
}

/**
 * Formats time window for display
 */
function formatTimeWindow(timeRange: { start: Date; end: Date }): string {
  const diffMs = timeRange.end.getTime() - timeRange.start.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  if (diffHours < 2) {
    return 'hour';
  } else if (diffHours < 24) {
    return `${Math.round(diffHours)} hours`;
  } else {
    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} day${diffDays > 1 ? 's' : ''}`;
  }
}

/**
 * Main summarization function
 */
export async function generateAISummary(request: SummarizationRequest): Promise<SummarizationResponse> {
  const timeRange = getTimeRange(request.timeWindow);

  // Build context
  let databases = mockData.databases;
  if (request.databaseIds && request.databaseIds.length > 0) {
    databases = databases.filter(db => request.databaseIds!.includes(db.id));
  }

  let context: SummarizationContext = {
    databases,
    issues: mockData.issues,
    metrics: [], // Could add time-series metrics here
    timeRange,
  };

  // Filter by time window
  context = filterDataByTimeWindow(context);

  let summary: string;
  let insights: string[];
  let recommendations: string[];

  // Use LLM if enabled
  if (request.useLLM && request.llmConfig) {
    try {
      const llmResponse = await callLLM(
        request.prompt,
        context,
        request.conversationHistory || [],
        request.llmConfig
      );

      const parsed = parseLLMResponse(llmResponse);
      summary = parsed.summary;
      insights = parsed.insights;
      recommendations = parsed.recommendations;

      // If LLM didn't provide enough insights/recommendations, supplement with generated ones
      if (insights.length < 3) {
        const healthInsights = analyzeHealth(context.databases);
        const { insights: issueInsights } = analyzeIssues(context.issues);
        insights = [...insights, ...healthInsights, ...issueInsights].slice(0, 5);
      }

      if (recommendations.length < 3) {
        const { recommendations: issueRecs } = analyzeIssues(context.issues);
        const generalRecs = generateRecommendations(context);
        recommendations = [...recommendations, ...issueRecs, ...generalRecs].slice(0, 5);
      }
    } catch (error) {
      console.error('LLM error, falling back to mock:', error);
      // Fall back to mock generation
      summary = generateSummary(context, request.prompt);
      const healthInsights = analyzeHealth(context.databases);
      const { insights: issueInsights, recommendations: issueRecs } = analyzeIssues(context.issues);
      const generalRecs = generateRecommendations(context);
      insights = [...healthInsights, ...issueInsights].slice(0, 5);
      recommendations = [...issueRecs, ...generalRecs].slice(0, 5);
    }
  } else {
    // Use mock generation
    await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate delay
    summary = generateSummary(context, request.prompt);
    const healthInsights = analyzeHealth(context.databases);
    const { insights: issueInsights, recommendations: issueRecs } = analyzeIssues(context.issues);
    const generalRecs = generateRecommendations(context);
    insights = [...healthInsights, ...issueInsights].slice(0, 5);
    recommendations = [...issueRecs, ...generalRecs].slice(0, 5);
  }

  // Identify affected databases
  const affectedDatabases = context.databases
    .filter(db => db.healthStatus === 'critical' || db.healthStatus === 'warning' || db.activeIssues > 0)
    .map(db => ({
      id: db.id,
      name: db.name,
      severity: (db.healthStatus === 'critical' || db.activeIssues > 0) ? 'critical' as const : 'warning' as const,
    }))
    .slice(0, 10); // Limit to top 10

  return {
    summary,
    insights,
    recommendations,
    affectedDatabases,
    dataPoints: {
      metricsAnalyzed: databases.length * 7, // 7 metrics per database
      issuesFound: context.issues.length,
      logsProcessed: Math.floor(Math.random() * 10000) + 1000, // Mock log count
    },
    timestamp: new Date(),
    conversationId: request.conversationHistory?.[0]?.id.split('-')[0], // Use first message ID as conversation ID
  };
}
