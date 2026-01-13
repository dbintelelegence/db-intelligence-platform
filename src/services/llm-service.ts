import type { LLMConfig, ConversationMessage, SummarizationContext } from '@/types/summarization';

/**
 * Builds a system prompt with database context
 */
function buildSystemPrompt(context: SummarizationContext): string {
  const { databases, issues, timeRange } = context;

  const criticalDbs = databases.filter(db => db.healthStatus === 'critical');
  const warningDbs = databases.filter(db => db.healthStatus === 'warning');
  const criticalIssues = issues.filter((i: any) => i.severity === 'critical');

  return `You are an AI database infrastructure analyst with deep expertise in database operations, performance optimization, and troubleshooting.

# Current Database State

**Time Window**: ${timeRange.start.toISOString()} to ${timeRange.end.toISOString()}

**Overview**:
- Total Databases: ${databases.length}
- Healthy: ${databases.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good').length}
- Warning State: ${warningDbs.length}
- Critical State: ${criticalDbs.length}
- Total Issues: ${issues.length}
- Critical Issues: ${criticalIssues.length}

**Resource Utilization Summary**:
- Average CPU: ${Math.round(databases.reduce((sum, db) => sum + db.metrics.cpu, 0) / databases.length)}%
- Average Memory: ${Math.round(databases.reduce((sum, db) => sum + db.metrics.memory, 0) / databases.length)}%
- Average Storage: ${Math.round(databases.reduce((sum, db) => sum + db.metrics.storage, 0) / databases.length)}%
- Average Latency: ${Math.round(databases.reduce((sum, db) => sum + db.metrics.latency, 0) / databases.length)}ms

**Databases by Cloud Provider**:
- AWS: ${databases.filter(db => db.cloud === 'aws').length}
- GCP: ${databases.filter(db => db.cloud === 'gcp').length}
- Azure: ${databases.filter(db => db.cloud === 'azure').length}

**Database Types**:
${databases.reduce((acc, db) => {
  acc[db.type] = (acc[db.type] || 0) + 1;
  return acc;
}, {} as Record<string, number>)}

# Your Role

Analyze the user's questions about their database infrastructure and provide:
1. **Clear, concise answers** based on the data provided
2. **Actionable insights** about performance, health, and issues
3. **Specific recommendations** with priority levels
4. **Context-aware responses** that reference specific databases when relevant

# Response Guidelines

- Be concise but thorough
- Use bullet points for lists
- Reference specific databases by name when discussing issues
- Provide actionable recommendations
- Explain technical concepts clearly
- If you identify patterns across multiple databases, highlight them
- Prioritize critical issues over warnings
- Consider cost implications when relevant

# Data Available

You have access to:
- Real-time metrics (CPU, memory, storage, connections, latency, throughput)
- Health scores and status for all databases
- Active issues with severity levels and categories
- Cost data and trends
- Database metadata (cloud provider, region, environment, type)

Answer the user's questions based on this context. If asked to summarize or analyze, structure your response with clear sections.`;
}

/**
 * Builds context data string for the LLM
 */
function buildContextData(context: SummarizationContext): string {
  const { databases, issues } = context;

  let contextStr = '\n\n# Detailed Database Information\n\n';

  // Add critical and warning databases
  const problematicDbs = databases.filter(db =>
    db.healthStatus === 'critical' ||
    db.healthStatus === 'warning' ||
    db.activeIssues > 0
  ).slice(0, 20); // Limit to top 20

  if (problematicDbs.length > 0) {
    contextStr += '## Databases Requiring Attention\n\n';
    problematicDbs.forEach(db => {
      contextStr += `**${db.name}** (${db.type} on ${db.cloud.toUpperCase()})\n`;
      contextStr += `- Health: ${db.healthStatus} (${db.healthScore}/100)\n`;
      contextStr += `- CPU: ${db.metrics.cpu}%, Memory: ${db.metrics.memory}%, Storage: ${db.metrics.storage}%\n`;
      contextStr += `- Latency: ${db.metrics.latency}ms, Throughput: ${db.metrics.throughput} qps\n`;
      contextStr += `- Connections: ${db.metrics.connections}/${db.metrics.maxConnections}\n`;
      contextStr += `- Active Issues: ${db.activeIssues}\n`;
      contextStr += `- Monthly Cost: $${db.monthlyCost.toFixed(2)} (${db.costTrend})\n\n`;
    });
  }

  // Add critical issues
  const criticalIssues = issues
    .filter((i: any) => i.severity === 'critical')
    .slice(0, 10);

  if (criticalIssues.length > 0) {
    contextStr += '## Critical Issues\n\n';
    criticalIssues.forEach((issue: any) => {
      contextStr += `**${issue.title}** (${issue.databaseName})\n`;
      contextStr += `- Severity: ${issue.severity}\n`;
      contextStr += `- Category: ${issue.category}\n`;
      contextStr += `- Status: ${issue.status}\n`;
      contextStr += `- Description: ${issue.description}\n`;
      if (issue.recommendation) {
        contextStr += `- Recommendation: ${issue.recommendation}\n`;
      }
      contextStr += `\n`;
    });
  }

  return contextStr;
}

/**
 * Calls OpenAI API
 */
async function callOpenAI(
  messages: { role: string; content: string }[],
  config: LLMConfig
): Promise<string> {
  const apiKey = config.apiKey || import.meta.env.VITE_OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Set VITE_OPENAI_API_KEY in your .env file.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4-turbo-preview',
      messages,
      temperature: config.temperature || 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Calls Anthropic API (Claude)
 */
async function callAnthropic(
  messages: { role: string; content: string }[],
  config: LLMConfig
): Promise<string> {
  const apiKey = config.apiKey || import.meta.env.VITE_ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('Anthropic API key not configured. Set VITE_ANTHROPIC_API_KEY in your .env file.');
  }

  // Convert messages format for Anthropic
  const systemMessage = messages.find(m => m.role === 'system');
  const conversationMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      temperature: config.temperature || 0.7,
      system: systemMessage?.content || '',
      messages: conversationMessages,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.content[0].text;
}

/**
 * Main LLM service function
 */
export async function callLLM(
  prompt: string,
  context: SummarizationContext,
  conversationHistory: ConversationMessage[] = [],
  config: LLMConfig
): Promise<string> {
  // Build system prompt with context
  const systemPrompt = buildSystemPrompt(context);
  const contextData = buildContextData(context);

  // Build messages array
  const messages: { role: string; content: string }[] = [
    {
      role: 'system',
      content: systemPrompt + contextData,
    },
  ];

  // Add conversation history
  conversationHistory.forEach(msg => {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  });

  // Add current prompt
  messages.push({
    role: 'user',
    content: prompt,
  });

  // Call appropriate LLM
  switch (config.provider) {
    case 'openai':
      return await callOpenAI(messages, config);

    case 'anthropic':
      return await callAnthropic(messages, config);

    case 'mock':
    default:
      // Return mock response for testing
      return `This is a mock LLM response. Enable real LLM integration by:

1. Set your API key in environment variables:
   - For OpenAI: VITE_OPENAI_API_KEY
   - For Anthropic: VITE_ANTHROPIC_API_KEY

2. Select your preferred provider in settings

Based on your question: "${prompt}"

I would analyze your ${context.databases.length} databases and ${context.issues.length} issues to provide detailed insights.`;
  }
}

/**
 * Parses LLM response into structured format
 */
export function parseLLMResponse(llmResponse: string): {
  summary: string;
  insights: string[];
  recommendations: string[];
} {
  // Try to extract structured sections from the response
  const insights: string[] = [];
  const recommendations: string[] = [];

  // Look for bullet points or numbered lists
  const lines = llmResponse.split('\n');
  let currentSection: 'summary' | 'insights' | 'recommendations' | 'none' = 'summary';
  let summaryLines: string[] = [];

  for (const line of lines) {
    const lowerLine = line.toLowerCase();

    if (lowerLine.includes('insight') || lowerLine.includes('finding') || lowerLine.includes('observation')) {
      currentSection = 'insights';
      continue;
    } else if (lowerLine.includes('recommend') || lowerLine.includes('action') || lowerLine.includes('next step')) {
      currentSection = 'recommendations';
      continue;
    }

    // Extract bullet points or numbered items
    const bulletMatch = line.match(/^[\s]*[•\-\*]\s+(.+)$/);
    const numberedMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);

    if (bulletMatch || numberedMatch) {
      const content = (bulletMatch || numberedMatch)![1].trim();
      if (currentSection === 'insights' && content.length > 10) {
        insights.push(content);
      } else if (currentSection === 'recommendations' && content.length > 10) {
        recommendations.push(content);
      }
    } else if (currentSection === 'summary' && line.trim()) {
      summaryLines.push(line.trim());
    }
  }

  // If no structured sections found, use the whole response as summary
  let summary = summaryLines.join('\n').trim();
  if (!summary) {
    summary = llmResponse;
  }

  return {
    summary: summary || llmResponse,
    insights: insights.slice(0, 5),
    recommendations: recommendations.slice(0, 5),
  };
}
