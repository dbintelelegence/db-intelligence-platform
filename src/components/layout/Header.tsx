import { Database, Bell, User, Sun, Moon, Sparkles, Search } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { SummarizationPanel } from '@/components/features/summarization/SummarizationPanel';
import { AlertsDropdown } from './AlertsDropdown';
import { mockData } from '@/data/mock-data';
import { useState } from 'react';

export function Header() {
  const { theme, toggleTheme } = useTheme();
  const [showSummarization, setShowSummarization] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);

  const unreadCount = mockData.alerts.filter((a) => a.status === 'unread').length;

  // Open command palette programmatically when search bar is clicked
  const openPalette = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k', metaKey: true, bubbles: true
    }));
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between pl-6 pr-4 gap-4">
        {/* Logo */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Database className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-base font-bold hidden sm:block">DB Intelligence</span>
        </div>

        {/* Search bar — centre of header, clickable shortcut to Cmd+K */}
        <button
          onClick={openPalette}
          className="flex-1 max-w-sm flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/50 hover:bg-muted transition-colors text-left"
        >
          <Search className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm text-muted-foreground flex-1">Search clusters, issues…</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground font-mono flex-shrink-0">
            ⌘K
          </kbd>
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* AI assistant */}
          <button
            onClick={() => setShowSummarization(true)}
            className="hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-sm font-medium"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Ask AI</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 hover:bg-accent transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowAlerts(!showAlerts)}
              className="relative rounded-lg p-2 hover:bg-accent transition-colors"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
                </span>
              )}
            </button>
            {showAlerts && <AlertsDropdown onClose={() => setShowAlerts(false)} />}
          </div>

          {/* User */}
          <button className="rounded-lg p-1 hover:bg-accent transition-colors">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary">
              <User className="h-4 w-4 text-primary-foreground" />
            </div>
          </button>
        </div>
      </div>

      {showSummarization && (
        <SummarizationPanel onClose={() => setShowSummarization(false)} />
      )}
    </header>
  );
}
