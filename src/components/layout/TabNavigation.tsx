import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Database, AlertTriangle, DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mockData } from '@/data/mock-data';

export function TabNavigation() {
  const location = useLocation();

  // Calculate issue counts for badge
  const criticalIssuesCount = mockData.issues.filter(i => i.severity === 'critical').length;

  const tabs = [
    {
      name: 'Overview',
      path: '/',
      icon: LayoutDashboard,
    },
    {
      name: 'Databases',
      path: '/databases',
      icon: Database,
      badge: mockData.databases.length,
    },
    {
      name: 'Issues & Anomalies',
      path: '/issues',
      icon: AlertTriangle,
      badge: criticalIssuesCount,
      badgeColor: 'bg-red-500',
    },
    {
      name: 'Billing & Cost',
      path: '/billing',
      icon: DollarSign,
    },
  ];

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="border-b bg-background">
      <div className="container px-6">
        <div className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.path);

            return (
              <Link
                key={tab.path}
                to={tab.path}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative',
                  'hover:text-foreground border-b-2 -mb-[2px]',
                  active
                    ? 'text-foreground border-primary'
                    : 'text-muted-foreground border-transparent hover:border-muted'
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.name}</span>
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span
                    className={cn(
                      'ml-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white',
                      tab.badgeColor || 'bg-primary'
                    )}
                  >
                    {tab.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
