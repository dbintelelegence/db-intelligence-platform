export type TimeWindow = '1h' | '6h' | '24h' | '7d' | '30d';

export type LLMProvider = 'openai' | 'anthropic' | 'mock';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  model?: string;
  temperature?: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  dataPoints?: {
    metricsAnalyzed: number;
    issuesFound: number;
    logsProcessed: number;
  };
}

export interface SummarizationRequest {
  prompt: string;
  timeWindow: TimeWindow;
  conversationHistory?: ConversationMessage[];  // For multi-turn conversations
  databaseIds?: string[];  // Optional: filter to specific databases
  includeMetrics?: boolean;
  includeLogs?: boolean;
  includeIssues?: boolean;
  useLLM?: boolean;  // If true, use real LLM; if false, use mock
  llmConfig?: LLMConfig;
}

export interface SummarizationResponse {
  summary: string;
  insights: string[];
  recommendations: string[];
  affectedDatabases: {
    id: string;
    name: string;
    severity: 'critical' | 'warning' | 'info';
  }[];
  dataPoints: {
    metricsAnalyzed: number;
    issuesFound: number;
    logsProcessed: number;
  };
  timestamp: Date;
  conversationId?: string;  // For tracking multi-turn conversations
}

export interface SummarizationContext {
  databases: any[];
  issues: any[];
  metrics: any[];
  timeRange: {
    start: Date;
    end: Date;
  };
}
