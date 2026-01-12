import { Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Database, AlertTriangle, DollarSign, Cloud, Server, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mockData } from '@/data/mock-data';
import { useState } from 'react';

export function TabNavigation() {
  const location = useLocation();
  const [isDatabasesExpanded, setIsDatabasesExpanded] = useState(false);

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

  // Calculate counts by cloud provider
  const awsCount = mockData.databases.filter(db => db.cloud === 'aws').length;
  const gcpCount = mockData.databases.filter(db => db.cloud === 'gcp').length;
  const azureCount = mockData.databases.filter(db => db.cloud === 'azure').length;

  // Calculate counts by database type
  const postgresCount = mockData.databases.filter(db => db.type === 'postgres').length;
  const mysqlCount = mockData.databases.filter(db => db.type === 'mysql').length;
  const mongoCount = mockData.databases.filter(db => db.type === 'mongodb').length;
  const redisCount = mockData.databases.filter(db => db.type === 'redis').length;
  const dynamoCount = mockData.databases.filter(db => db.type === 'dynamodb').length;
  const auroraCount = mockData.databases.filter(db => db.type === 'aurora').length;

  const cloudGroups = [
    { name: 'AWS', path: '/databases?cloud=aws', count: awsCount, color: 'text-orange-600' },
    { name: 'GCP', path: '/databases?cloud=gcp', count: gcpCount, color: 'text-blue-600' },
    { name: 'Azure', path: '/databases?cloud=azure', count: azureCount, color: 'text-sky-600' },
  ];

  const dbTypeGroups = [
    { name: 'PostgreSQL', path: '/databases?type=postgres', count: postgresCount },
    { name: 'MySQL', path: '/databases?type=mysql', count: mysqlCount },
    { name: 'MongoDB', path: '/databases?type=mongodb', count: mongoCount },
    { name: 'Redis', path: '/databases?type=redis', count: redisCount },
    { name: 'DynamoDB', path: '/databases?type=dynamodb', count: dynamoCount },
    { name: 'Aurora', path: '/databases?type=aurora', count: auroraCount },
  ];

  return (
    <nav className="w-64 border-r bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 h-[calc(100vh-4rem)] sticky top-16 flex-shrink-0 overflow-y-auto">
      <div className="flex flex-col gap-1 p-4">
        {/* Main Navigation */}
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.path);
          const isDatabasesTab = tab.path === '/databases';

          return (
            <div key={tab.path}>
              {/* Main Tab */}
              <div className="flex items-center">
                <Link
                  to={tab.path}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors rounded-lg relative flex-1',
                    'hover:bg-muted',
                    active
                      ? 'bg-primary/10 text-primary border-l-4 border-primary'
                      : 'text-muted-foreground border-l-4 border-transparent'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="flex-1">{tab.name}</span>
                  {tab.badge !== undefined && tab.badge > 0 && (
                    <span
                      className={cn(
                        'flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold text-white',
                        tab.badgeColor || 'bg-primary'
                      )}
                    >
                      {tab.badge}
                    </span>
                  )}
                </Link>
                {isDatabasesTab && (
                  <button
                    onClick={() => setIsDatabasesExpanded(!isDatabasesExpanded)}
                    className="p-2 hover:bg-muted rounded-lg transition-colors"
                  >
                    {isDatabasesExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                )}
              </div>

              {/* Databases Submenu */}
              {isDatabasesTab && isDatabasesExpanded && (
                <div className="ml-4 mt-2 flex flex-col gap-4 border-l-2 border-muted pl-4">
                  {/* Group by Cloud */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 py-1">
                      <Cloud className="h-3.5 w-3.5 text-muted-foreground" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        By Cloud
                      </h3>
                    </div>
                    <div className="flex flex-col gap-1">
                      {cloudGroups.map((group) => (
                        <Link
                          key={group.path}
                          to={group.path}
                          className={cn(
                            'flex items-center justify-between px-3 py-2 text-sm transition-colors rounded-lg',
                            'hover:bg-muted',
                            'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <span className={cn('font-medium', group.color)}>{group.name}</span>
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{group.count}</span>
                        </Link>
                      ))}
                    </div>
                  </div>

                  {/* Group by Database Type */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 py-1">
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        By Type
                      </h3>
                    </div>
                    <div className="flex flex-col gap-1">
                      {dbTypeGroups.map((group) => (
                        <Link
                          key={group.path}
                          to={group.path}
                          className={cn(
                            'flex items-center justify-between px-3 py-2 text-sm transition-colors rounded-lg',
                            'hover:bg-muted',
                            'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          <span>{group.name}</span>
                          <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{group.count}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
