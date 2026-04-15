/**
 * ClusterAIPanel
 *
 * A scoped AI assistant tied to a single cluster.
 * Unlike the fleet-wide "Ask AI" in the header, this one:
 *  - Starts with full knowledge of this cluster's active issues and metrics
 *  - Generates suggested questions dynamically based on what's actually wrong
 *  - Keeps the conversation scoped — it won't answer about other clusters
 *  - Shows a compact inline UI, not a floating modal
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Sparkles, Send, ChevronDown, ChevronRight, User, Bot, Loader2 } from 'lucide-react';
import type { Database, Issue } from '@/types';
import type { ConversationMessage } from '@/types/summarization';

// ── Suggested question generation ────────────────────────────────────────────

function buildSuggestedQuestions(db: Database, issues: Issue[]): string[] {
  const questions: string[] = [];
  const activeIssues = issues.filter(i => i.status === 'active');
  const criticalIssues = activeIssues.filter(i => i.severity === 'critical');

  // Issue-specific questions — most useful when something is actively wrong
  if (criticalIssues.length > 0) {
    const first = criticalIssues[0];
    questions.push(`Why is ${first.title.toLowerCase()} happening on this cluster?`);
    questions.push(`What's the fastest way to fix the ${first.category} issue?`);
  }

  if (activeIssues.length > 1) {
    questions.push(`Are the ${activeIssues.length} active issues related to each other?`);
  }

  // Metric-specific questions based on what's elevated
  if (db.metrics.cpu > 70) {
    questions.push(`What's likely causing the high CPU on ${db.name}?`);
  }
  if (db.metrics.memory > 75) {
    questions.push(`How do I reduce memory pressure on this cluster?`);
  }
  if (db.metrics.latency > 80) {
    questions.push(`Why has query latency increased and how do I fix it?`);
  }
  if (db.metrics.storage > 80) {
    questions.push(`How long until storage is full and what should I do?`);
  }
  if (db.metrics.connections > db.metrics.maxConnections * 0.75) {
    questions.push(`Connection usage is high — is this a problem?`);
  }

  // General questions always available
  questions.push(`Give me a plain-English summary of this cluster's health`);
  questions.push(`What should I monitor closely on ${db.name} this week?`);
  questions.push(`Is the cost trend for this cluster normal?`);

  // Return top 4, prioritising the most specific ones
  return questions.slice(0, 4);
}

// ── System prompt builder ─────────────────────────────────────────────────────

function buildClusterSystemPrompt(db: Database, issues: Issue[]): string {
  const activeIssues = issues.filter(i => i.status === 'active');
  const critical = activeIssues.filter(i => i.severity === 'critical');

  const issueBlock = activeIssues.length === 0
    ? 'None — cluster is healthy'
    : activeIssues.map(i => {
        const lines = [
          `[${i.severity.toUpperCase()}] ${i.title}`,
          `  Observed: ${i.description}`,
        ];
        if (i.explanation && i.explanation !== i.description) {
          lines.push(`  Analysis: ${i.explanation}`);
        }
        lines.push(`  Recommendation: ${i.recommendation}`);
        if (i.relatedMetrics?.length) {
          lines.push(`  Evidence signals: ${i.relatedMetrics.join(', ')}`);
        }
        return lines.join('\n');
      }).join('\n\n');

  // MySQL-specific metric labels
  const isMysql = db.type === 'mysql';
  const mysqlMetrics = isMysql ? `
- Connection pool: ${db.metrics.connections}% used
- Replication lag: ${(db as any).metrics?.replicationLagMs != null ? `${(db as any).metrics.replicationLagMs}ms` : 'n/a'}
- Query latency: ${db.metrics.latency}ms
- Throughput: ${db.metrics.throughput} qps` : `
- JVM heap: ${db.metrics.memory}%
- Latency: ${db.metrics.latency}ms
- Throughput: ${db.metrics.throughput} qps`;

  return `You are an expert database reliability engineer analysing a single specific cluster.
Your answers are grounded in the analyzer evidence below — do not speculate beyond it.

CLUSTER: ${db.name}
TYPE: ${db.type.toUpperCase()}
CLOUD: ${db.cloud.toUpperCase()} / ${db.region}
HEALTH STATUS: ${db.healthStatus} (score: ${db.healthScore}/100)

CURRENT METRICS:
- CPU: ${db.metrics.cpu}%
- Storage: ${db.metrics.storage}%${mysqlMetrics}

ACTIVE ISSUES (${activeIssues.length} total, ${critical.length} critical):
${issueBlock}

RULES:
- Answer questions about this cluster only
- Reference the specific observed values and sigma scores in the analysis above
- If two issues are present, reason about whether they are causally related
- Suggest concrete next steps with exact SQL/commands where possible
- Keep responses concise — the user is likely mid-incident
- Never recommend actions that modify database configuration without stating it is a manual step

The user is a ${db.environment === 'production' ? 'production engineer under time pressure' : 'developer on a non-production cluster'}.`;
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';

  // Simple markdown-ish rendering — bold, code blocks, bullet points
  const renderContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, i) => {
      // Code block line
      if (line.startsWith('```') || line.startsWith('    ')) {
        return (
          <code key={i} className="block bg-muted px-2 py-0.5 rounded text-xs font-mono my-0.5 text-foreground">
            {line.replace(/^```\w*/, '').replace(/^    /, '')}
          </code>
        );
      }
      // Bullet
      if (line.startsWith('- ') || line.startsWith('• ')) {
        return (
          <div key={i} className="flex gap-1.5 my-0.5">
            <span className="text-muted-foreground mt-0.5 flex-shrink-0">·</span>
            <span>{line.replace(/^[-•]\s/, '')}</span>
          </div>
        );
      }
      // Bold headings
      if (line.startsWith('**') && line.endsWith('**')) {
        return <p key={i} className="font-semibold mt-2 first:mt-0">{line.replace(/\*\*/g, '')}</p>;
      }
      // Empty line
      if (!line.trim()) return <div key={i} className="h-1" />;
      return <p key={i}>{line}</p>;
    });
  };

  return (
    <div className={cn('flex gap-2.5', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div className={cn(
        'max-w-[85%] rounded-xl px-3 py-2.5 text-sm leading-relaxed',
        isUser
          ? 'bg-primary text-primary-foreground rounded-tr-sm'
          : 'bg-muted text-foreground rounded-tl-sm'
      )}>
        {renderContent(message.content)}
        <p className={cn(
          'text-[10px] mt-1.5',
          isUser ? 'text-primary-foreground/60 text-right' : 'text-muted-foreground'
        )}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center mt-0.5">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ClusterAIPanelProps {
  database: Database;
  issues: Issue[];
}

export function ClusterAIPanel({ database, issues }: ClusterAIPanelProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestedQuestions = buildSuggestedQuestions(database, issues);
  const activeIssueCount = issues.filter(i => i.status === 'active').length;

  // Scroll to bottom when messages update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: ConversationMessage = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const systemPrompt = buildClusterSystemPrompt(database, issues);

      // Call our backend proxy directly — keeps API key server-side,
      // passes full conversation history for multi-turn context
      const resp = await fetch('http://localhost:8000/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          messages: updatedMessages.map(m => ({ role: m.role, content: m.content })),
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          temperature: 0.3,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        const detail = err.detail || '';
        if (detail.includes('credit balance') || detail.includes('quota')) {
          throw new Error('AI service is temporarily unavailable (API quota exceeded). The analyzer verdicts above are still accurate.');
        }
        throw new Error(`API error ${resp.status}`);
      }
      const data = await resp.json();

      setMessages(prev => [...prev, {
        id: `${Date.now()}-assistant`,
        role: 'assistant' as const,
        content: data.content,
        timestamp: new Date(),
      }]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong. Please try again.';
      setMessages(prev => [...prev, {
        id: `${Date.now()}-error`,
        role: 'assistant' as const,
        content: msg,
        timestamp: new Date(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <div className="rounded-lg border border-border overflow-hidden">

      {/* Toggle header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 bg-primary/5 hover:bg-primary/10 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold">Ask AI about {database.name}</p>
            <p className="text-xs text-muted-foreground">
              {activeIssueCount > 0
                ? `Scoped to this cluster · ${activeIssueCount} active issue${activeIssueCount !== 1 ? 's' : ''} in context`
                : 'Scoped to this cluster · all metrics in context'}
            </p>
          </div>
        </div>
        {open
          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border bg-background">

          {/* Suggested questions — shown when no conversation yet */}
          {messages.length === 0 && (
            <div className="p-3 border-b border-border">
              <p className="text-xs text-muted-foreground mb-2 px-1">
                {activeIssueCount > 0
                  ? 'Suggested questions based on active issues:'
                  : 'Suggested questions:'}
              </p>
              <div className="flex flex-col gap-1.5">
                {suggestedQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => send(q)}
                    disabled={loading}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-foreground leading-snug"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation */}
          {messages.length > 0 && (
            <div className="max-h-72 overflow-y-auto p-3 flex flex-col gap-3">
              {messages.map(m => <MessageBubble key={m.id} message={m} />)}
              {loading && (
                <div className="flex gap-2.5">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div className="bg-muted rounded-xl rounded-tl-sm px-3 py-2.5 flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" />
                    <span className="text-xs text-muted-foreground">Thinking…</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* After first exchange — show quick follow-up suggestions */}
          {messages.length >= 2 && !loading && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {suggestedQuestions.slice(0, 2).map((q, i) => (
                <button
                  key={i}
                  onClick={() => send(q)}
                  className="text-xs px-2.5 py-1 rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground"
                >
                  {q.length > 40 ? q.slice(0, 37) + '…' : q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={`Ask anything about ${database.name}…`}
              disabled={loading}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground text-foreground"
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || loading}
              className={cn(
                'flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors',
                input.trim() && !loading
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
            >
              {loading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Scope reminder */}
          <div className="px-3 pb-2">
            <p className="text-[10px] text-muted-foreground">
              This assistant is scoped to {database.name} only.
              For fleet-wide questions use <span className="font-medium">Ask AI</span> in the top bar.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
