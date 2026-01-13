import { useState, useEffect, useRef } from 'react';
import { Sparkles, Clock, X, MessageSquare, GripVertical } from 'lucide-react';
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
  const [panelWidth, setPanelWidth] = useState(672); // 42rem default (max-w-2xl)
  const [panelHeight, setPanelHeight] = useState(0); // Will be calculated on mount
  const [position, setPosition] = useState({ x: 0, y: 20 }); // Start top-right
  const [isResizing, setIsResizing] = useState<'left' | 'top' | 'corner' | false>(false);
  const [isDragging, setIsDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, panelX: 0, panelY: 0 });

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

  // Initialize panel height and position on mount
  useEffect(() => {
    const updateHeight = () => {
      const headerHeight = 80; // 5rem
      const padding = 32; // 2rem top + bottom padding
      const newHeight = window.innerHeight - headerHeight - padding;
      setPanelHeight(newHeight);

      // Set initial position to top-right
      setPosition({
        x: window.innerWidth - panelWidth - 32, // 32px padding from right
        y: 20, // 20px from top
      });
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Handle drag functionality
  const handleDragStart = (e: React.MouseEvent) => {
    // Only allow dragging from header, not from resize handles
    if ((e.target as HTMLElement).closest('.resize-handle')) {
      return;
    }

    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      panelX: position.x,
      panelY: position.y,
    };
  };

  // Handle resize functionality
  const handleMouseDown = (direction: 'left' | 'top' | 'corner') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsResizing(direction);
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: panelWidth,
      height: panelHeight,
    };
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Handle dragging
      if (isDragging) {
        const deltaX = e.clientX - dragStartRef.current.mouseX;
        const deltaY = e.clientY - dragStartRef.current.mouseY;

        const newX = dragStartRef.current.panelX + deltaX;
        const newY = dragStartRef.current.panelY + deltaY;

        // Keep panel within viewport bounds
        const maxX = window.innerWidth - panelWidth - 32; // 32px padding
        const maxY = window.innerHeight - panelHeight - 32;

        setPosition({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        });
        return;
      }

      // Handle resizing
      if (!isResizing) return;

      const minWidth = 400;
      const maxWidth = window.innerWidth * 0.9;
      const minHeight = 300;
      const maxHeight = window.innerHeight - 100;

      if (isResizing === 'left' || isResizing === 'corner') {
        // Resize from left edge (dragging left increases width)
        const deltaX = startPosRef.current.x - e.clientX;
        const newWidth = startPosRef.current.width + deltaX;

        if (newWidth >= minWidth && newWidth <= maxWidth) {
          setPanelWidth(newWidth);
          // Adjust position to keep right edge fixed
          setPosition(prev => ({ ...prev, x: prev.x - (newWidth - panelWidth) }));
        }
      }

      if (isResizing === 'top' || isResizing === 'corner') {
        // Resize from top edge (dragging up increases height)
        const deltaY = startPosRef.current.y - e.clientY;
        const newHeight = startPosRef.current.height + deltaY;

        if (newHeight >= minHeight && newHeight <= maxHeight) {
          setPanelHeight(newHeight);
          // Adjust position to keep bottom edge fixed
          setPosition(prev => ({ ...prev, y: prev.y - (newHeight - panelHeight) }));
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      setIsDragging(false);
    };

    if (isResizing || isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      if (isDragging) {
        document.body.style.cursor = 'move';
      } else if (isResizing === 'left') {
        document.body.style.cursor = 'ew-resize';
      } else if (isResizing === 'top') {
        document.body.style.cursor = 'ns-resize';
      } else if (isResizing === 'corner') {
        document.body.style.cursor = 'nwse-resize';
      }

      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, isDragging, panelHeight, panelWidth, position.x, position.y]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className="bg-background rounded-lg shadow-2xl overflow-hidden flex flex-row border relative"
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${panelWidth}px`,
          height: panelHeight > 0 ? `${panelHeight}px` : 'calc(100vh - 6rem)',
        }}
      >
        {/* Left Resize Handle */}
        <div
          className="resize-handle absolute left-0 top-0 bottom-0 w-1 hover:w-2 bg-transparent hover:bg-primary/50 cursor-ew-resize z-10 transition-all"
          onMouseDown={handleMouseDown('left')}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 hover:opacity-100 transition-opacity">
            <GripVertical className="h-6 w-6 text-primary" />
          </div>
        </div>

        {/* Top Resize Handle */}
        <div
          className="resize-handle absolute top-0 left-0 right-0 h-1 hover:h-2 bg-transparent hover:bg-primary/50 cursor-ns-resize z-10 transition-all"
          onMouseDown={handleMouseDown('top')}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-90 opacity-0 hover:opacity-100 transition-opacity">
            <GripVertical className="h-6 w-6 text-primary" />
          </div>
        </div>

        {/* Top-Left Corner Resize Handle */}
        <div
          className="resize-handle absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-20"
          onMouseDown={handleMouseDown('corner')}
        >
          <div className="absolute top-1 left-1 w-2 h-2 bg-primary/30 hover:bg-primary/70 rounded-full transition-colors" />
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header - Draggable */}
        <div
          className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-primary/10 to-primary/5 cursor-move"
          onMouseDown={handleDragStart}
        >
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

          <div className="flex items-center gap-3">
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

            {/* Close button - Highly visible */}
            {onClose && (
              <button
                onClick={onClose}
                className="rounded-lg p-2 bg-muted/50 hover:bg-red-500 hover:text-white transition-all border border-border hover:border-red-500 flex items-center justify-center"
                aria-label="Close"
                title="Close (ESC)"
              >
                <X className="h-5 w-5 stroke-[2.5]" />
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
    </div>
  );
}
