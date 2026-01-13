import { useState, useEffect } from 'react';
import { Sparkles, Clock, X, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TimeWindow, ConversationMessage, LLMConfig } from '@/types/summarization';
import { generateAISummary } from '@/services/summarization-service';
import { ChatInterface } from './ChatInterface';

interface SummarizationPanelProps {
  onClose?: () => void;
}

const TIME_WINDOWS: { value: TimeWindow; label: string }[] = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

export function SummarizationPanel({ onClose }: SummarizationPanelProps) {
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('24h');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [llmConfig, setLLMConfig] = useState<LLMConfig>({
    provider: 'mock',
    temperature: 0.7,
  });

  const handleSendMessage = async (messageText: string) => {
    // Add user message
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
        conversationHistory: messages,
        includeMetrics: true,
        includeLogs: true,
        includeIssues: true,
        useLLM: llmConfig.provider !== 'mock',
        llmConfig,
      });

      // Build assistant response message
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

        if (critical.length > 0) {
          responseContent += `\n🔴 Critical: ${critical.map(db => db.name).join(', ')}`;
        }
        if (warnings.length > 0) {
          responseContent += `\n🟠 Warning: ${warnings.map(db => db.name).join(', ')}`;
        }
      }

      const assistantMessage: ConversationMessage = {
        id: `${Date.now()}-assistant`,
        role: 'assistant',
        content: responseContent,
        timestamp: new Date(),
        dataPoints: result.dataPoints,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error: any) {
      const errorMessage: ConversationMessage = {
        id: `${Date.now()}-error`,
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error.message}\n\nPlease try again or check your LLM configuration.`,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfigChange = (config: LLMConfig) => {
    setLLMConfig(config);
  };

  const handleClearConversation = () => {
    setMessages([]);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // Only close if clicking the backdrop, not the modal content
    if (e.target === e.currentTarget && onClose) {
      onClose();
    }
  };

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-background rounded-lg shadow-2xl w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col border">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-primary/10 to-primary/5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-lg font-bold">AI Database Assistant</h2>
              <p className="text-xs text-muted-foreground">
                Interactive conversation about your infrastructure
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Time Window Selector */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background border">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <select
                value={timeWindow}
                onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
                className="text-sm font-medium bg-transparent border-none focus:outline-none cursor-pointer"
              >
                {TIME_WINDOWS.map((window) => (
                  <option key={window.value} value={window.value}>
                    {window.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear conversation */}
            {messages.length > 0 && (
              <button
                onClick={handleClearConversation}
                className="px-3 py-1.5 text-sm rounded-lg hover:bg-muted transition-colors flex items-center gap-2"
                title="Clear conversation"
              >
                <MessageSquare className="h-4 w-4" />
                Clear
              </button>
            )}

            {/* Close button */}
            {onClose && (
              <button
                onClick={onClose}
                className="rounded-full p-2 hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* Chat Interface */}
        <div className="flex-1 overflow-hidden">
          <ChatInterface
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            timeWindow={timeWindow}
            llmConfig={llmConfig}
            onConfigChange={handleConfigChange}
          />
        </div>
      </div>
    </div>
  );
}
