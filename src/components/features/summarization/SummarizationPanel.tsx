import { useState, useEffect } from 'react';
import { Sparkles, Clock, X, MessageSquare } from 'lucide-react';
import type { TimeWindow, ConversationMessage, LLMConfig } from '@/types/summarization';
import { generateAISummary } from '@/services/summarization-service';
import { useDashboard } from '@/hooks/useDashboard';
import { ChatInterface } from './ChatInterface';

interface SummarizationPanelProps {
  onClose?: () => void;
}

const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: '1h',  label: '1h' },
  { value: '6h',  label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d',  label: '7d' },
  { value: '30d', label: '30d' },
];

export function SummarizationPanel({ onClose }: SummarizationPanelProps) {
  const { clusters, issues: liveIssues } = useDashboard();
  const [timeWindow, setTimeWindow]       = useState<TimeWindow>('24h');
  const [isLoading, setIsLoading]         = useState(false);
  const [messages, setMessages]           = useState<ConversationMessage[]>([]);
  const [llmConfig, setLLMConfig]         = useState<LLMConfig>({
    provider: 'mock',
    temperature: 0.7,
  });

  // Close on ESC
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const handleSendMessage = async (messageText: string) => {
    const userMessage: ConversationMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const result = await generateAISummary({
        prompt: messageText,
        timeWindow,
        databases: clusters,
        issues: liveIssues,
        conversationHistory: messages,
        includeMetrics: true,
        includeLogs: true,
        includeIssues: true,
        useLLM: llmConfig.provider !== 'mock',
        llmConfig,
      });

      let responseContent = result.summary;

      if (result.insights.length > 0) {
        responseContent += '\n\n**Key Insights:**\n';
        result.insights.forEach((insight, i) => {
          responseContent += `${i + 1}. ${insight}\n`;
        });
      }
      if (result.recommendations.length > 0) {
        responseContent += '\n\n**Recommendations:**\n';
        result.recommendations.forEach((rec, i) => {
          responseContent += `${i + 1}. ${rec}\n`;
        });
      }
      if (result.affectedDatabases.length > 0) {
        responseContent += '\n\n**Affected Databases:**\n';
        const critical = result.affectedDatabases.filter(db => db.severity === 'critical');
        const warnings = result.affectedDatabases.filter(db => db.severity === 'warning');
        if (critical.length > 0) responseContent += `\n🔴 Critical: ${critical.map(db => db.name).join(', ')}`;
        if (warnings.length > 0) responseContent += `\n🟠 Warning: ${warnings.map(db => db.name).join(', ')}`;
      }

      setMessages(prev => [...prev, {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
        dataPoints: result.dataPoints,
      }]);
    } catch (error: any) {
      setMessages(prev => [...prev, {
        id: `${Date.now()}-error`,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}\n\nPlease try again or check your LLM configuration.`,
        timestamp: new Date(),
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Backdrop — click outside to close, page stays readable */}
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />

      {/* Right-side drawer — slides in from the right, below the sticky header */}
      <div className="fixed right-0 top-16 bottom-0 z-50 w-[480px] bg-background border-l shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b bg-gradient-to-r from-primary/10 to-primary/5 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">AI Database Assistant</h2>
              <p className="text-xs text-muted-foreground">Ask anything about your fleet</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Time window */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-background border text-xs">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <select
                value={timeWindow}
                onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
                className="bg-transparent border-none focus:outline-none cursor-pointer text-xs"
              >
                {TIME_WINDOWS.map(w => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>

            {/* Clear */}
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Clear conversation"
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            )}

            {/* Close */}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                aria-label="Close (ESC)"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Chat */}
        <div className="flex-1 overflow-hidden">
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            timeWindow={timeWindow}
            llmConfig={llmConfig}
            onConfigChange={setLLMConfig}
          />
        </div>
      </div>
    </>
  );
}
