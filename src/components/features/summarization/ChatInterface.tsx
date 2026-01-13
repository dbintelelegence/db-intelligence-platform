import { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, User as UserIcon, Settings, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationMessage, LLMConfig, TimeWindow } from '@/types/summarization';

interface ChatInterfaceProps {
  messages: ConversationMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  timeWindow: TimeWindow;
  llmConfig: LLMConfig;
  onConfigChange: (config: LLMConfig) => void;
}

export function ChatInterface({
  messages,
  onSendMessage,
  isLoading,
  timeWindow,
  llmConfig,
  onConfigChange,
}: ChatInterfaceProps) {
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 border-b bg-muted/50 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">LLM Configuration</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium">Provider</label>
            <select
              value={llmConfig.provider}
              onChange={(e) => onConfigChange({ ...llmConfig, provider: e.target.value as any })}
              className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
            >
              <option value="mock">Mock (No API Key Required)</option>
              <option value="openai">OpenAI (GPT-4)</option>
              <option value="anthropic">Anthropic (Claude)</option>
            </select>
          </div>

          {llmConfig.provider !== 'mock' && (
            <>
              <div className="space-y-2">
                <label className="text-xs font-medium">API Key</label>
                <input
                  type="password"
                  value={llmConfig.apiKey || ''}
                  onChange={(e) => onConfigChange({ ...llmConfig, apiKey: e.target.value })}
                  placeholder="Enter your API key"
                  className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  Or set {llmConfig.provider === 'openai' ? 'VITE_OPENAI_API_KEY' : 'VITE_ANTHROPIC_API_KEY'} in .env
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium">Model</label>
                <input
                  type="text"
                  value={llmConfig.model || ''}
                  onChange={(e) => onConfigChange({ ...llmConfig, model: e.target.value })}
                  placeholder={llmConfig.provider === 'openai' ? 'gpt-4-turbo-preview' : 'claude-3-5-sonnet-20241022'}
                  className="w-full px-3 py-2 text-sm rounded-lg border bg-background"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium">Temperature ({llmConfig.temperature || 0.7})</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={llmConfig.temperature || 0.7}
                  onChange={(e) => onConfigChange({ ...llmConfig, temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>
            </>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <Bot className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">Start a Conversation</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Ask questions about your database infrastructure. I'll analyze your metrics, issues, and logs to provide insights.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              'flex gap-3',
              message.role === 'user' ? 'justify-end' : 'justify-start'
            )}
          >
            {message.role === 'assistant' && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary flex-shrink-0">
                <Bot className="h-5 w-5 text-primary-foreground" />
              </div>
            )}

            <div
              className={cn(
                'rounded-lg px-4 py-3 max-w-[80%]',
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted'
              )}
            >
              <div className="text-sm whitespace-pre-wrap break-words">{message.content}</div>
              {message.dataPoints && (
                <div className="mt-3 pt-3 border-t border-border/50 flex gap-4 text-xs opacity-70">
                  <span>{message.dataPoints.metricsAnalyzed} metrics</span>
                  <span>{message.dataPoints.issuesFound} issues</span>
                  <span>{message.dataPoints.logsProcessed.toLocaleString()} logs</span>
                </div>
              )}
              <div className="text-xs opacity-50 mt-2">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>

            {message.role === 'user' && (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted flex-shrink-0">
                <UserIcon className="h-5 w-5" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary flex-shrink-0">
              <Bot className="h-5 w-5 text-primary-foreground" />
            </div>
            <div className="rounded-lg px-4 py-3 bg-muted">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing your database infrastructure...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about your databases... (Shift+Enter for new line)"
            className="flex-1 px-4 py-2 rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            rows={1}
            disabled={isLoading}
            style={{
              minHeight: '40px',
              maxHeight: '120px',
              height: 'auto',
            }}
          />

          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className={cn(
              'px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2',
              isLoading || !input.trim()
                ? 'bg-muted text-muted-foreground cursor-not-allowed'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            )}
          >
            <Send className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-4">
          <span>Time window: {timeWindow}</span>
          <span>Provider: {llmConfig.provider}</span>
          {llmConfig.provider !== 'mock' && llmConfig.apiKey && (
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              API Key Set
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
