import { cn } from '@/lib/utils';
import { Heart, Activity, AlertCircle, DollarSign } from 'lucide-react';

type TabValue = 'overview' | 'metrics' | 'issues' | 'cost';

interface TabNavigationProps {
  activeTab: TabValue;
  onTabChange: (tab: TabValue) => void;
}

interface Tab {
  value: TabValue;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const tabs: Tab[] = [
  {
    value: 'overview',
    label: 'Overview & Health',
    icon: Heart,
  },
  {
    value: 'metrics',
    label: 'Performance Metrics',
    icon: Activity,
  },
  {
    value: 'issues',
    label: 'Issues',
    icon: AlertCircle,
  },
  {
    value: 'cost',
    label: 'Cost',
    icon: DollarSign,
  },
];

export function TabNavigation({ activeTab, onTabChange }: TabNavigationProps) {
  return (
    <div className="border-b">
      <nav className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.value;

          return (
            <button
              key={tab.value}
              onClick={() => onTabChange(tab.value)}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap',
                isActive
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
