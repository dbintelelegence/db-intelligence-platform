import { Database, Bell, User, Sun, Moon, Activity, AlertCircle, TrendingUp, Sparkles } from 'lucide-react';
import { formatTimeAgo } from '@/lib/formatters';
import { useTheme } from '@/components/ThemeProvider';
import { mockData } from '@/data/mock-data';
import { SummarizationPanel } from '@/components/features/summarization/SummarizationPanel';
import { useState } from 'react';

export function Header() {
  const lastUpdated = new Date();
  const { theme, toggleTheme } = useTheme();
  const [showSummarization, setShowSummarization] = useState(false);

  // Calculate summary metrics
  const totalDatabases = mockData.databases.length;
  const healthyDatabases = mockData.databases.filter(db => db.healthStatus === 'excellent' || db.healthStatus === 'good').length;
  const criticalIssues = mockData.issues.filter(i => i.severity === 'critical').length;
  const healthPercentage = Math.round((healthyDatabases / totalDatabases) * 100);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-6">
        {/* Logo and Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <Database className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">
              DB Intelligence
              <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                v1.0.0
              </span>
            </h1>
            <p className="text-xs text-muted-foreground">Database Monitoring Platform</p>
          </div>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-4">
          {/* AI Summarization Button */}
          <button
            onClick={() => setShowSummarization(true)}
            className="hidden lg:flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-primary to-primary/80 text-primary-foreground hover:from-primary/90 hover:to-primary/70 transition-all shadow-sm hover:shadow-md"
          >
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium">AI Insights</span>
          </button>

          {/* Summary Section - Compact version */}
          <div className="hidden xl:flex items-center gap-3 px-4 py-2 border-l">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-green-500" />
              <span className="text-xs font-semibold">{healthPercentage}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 text-red-500" />
              <span className="text-xs font-semibold">{criticalIssues}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
              <span className="text-xs font-semibold">{totalDatabases}</span>
            </div>
          </div>

          {/* Last Updated */}
          <div className="hidden sm:block text-sm text-muted-foreground">
            Updated {formatTimeAgo(lastUpdated)}
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="rounded-full p-2 hover:bg-accent transition-colors"
            aria-label="Toggle theme"
          >
            {theme === 'light' ? (
              <Moon className="h-5 w-5" />
            ) : (
              <Sun className="h-5 w-5" />
            )}
          </button>

          {/* Notification Icon */}
          <button
            className="relative rounded-full p-2 hover:bg-accent transition-colors"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute top-1 right-1 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
            </span>
          </button>

          {/* User Avatar */}
          <button
            className="flex items-center gap-2 rounded-full p-2 hover:bg-accent transition-colors"
            aria-label="User menu"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary">
              <User className="h-5 w-5 text-primary-foreground" />
            </div>
          </button>
        </div>
      </div>

      {/* Summarization Modal */}
      {showSummarization && (
        <SummarizationPanel onClose={() => setShowSummarization(false)} />
      )}
    </header>
  );
}
