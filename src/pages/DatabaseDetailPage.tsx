import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTimeRange } from '@/hooks/useTimeRange';
import { getDatabaseById } from '@/data/mock-data';
import { DatabaseHeader } from '@/components/features/database-detail/DatabaseHeader';
import { DatabaseSummaryCards } from '@/components/features/database-detail/DatabaseSummaryCards';
import { TabNavigation } from '@/components/features/database-detail/TabNavigation';
import { OverviewTab } from '@/components/features/database-detail/OverviewTab';
import { MetricsTab } from '@/components/features/database-detail/MetricsTab';
import { IssuesTab } from '@/components/features/database-detail/IssuesTab';
import { CostTab } from '@/components/features/database-detail/CostTab';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export function DatabaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'metrics' | 'issues' | 'cost'>('overview');
  const { timeRange, setTimeRange } = useTimeRange('24h');

  const database = useMemo(() => {
    if (!id) return null;
    return getDatabaseById(id);
  }, [id]);

  if (!database) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
        <Card className="max-w-md p-6">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-2">
              <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-lg mb-1">Database Not Found</h3>
              <p className="text-sm text-muted-foreground">
                The database ID may be invalid or the database may have been removed.
              </p>
            </div>
          </div>
        </Card>
        <Button
          variant="outline"
          onClick={() => navigate('/databases')}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Databases
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DatabaseHeader
        database={database}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />

      <DatabaseSummaryCards database={database} />

      <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab database={database} timeRange={timeRange} />}
      {activeTab === 'metrics' && <MetricsTab database={database} timeRange={timeRange} />}
      {activeTab === 'issues' && <IssuesTab databaseId={database.id} timeRange={timeRange} />}
      {activeTab === 'cost' && <CostTab database={database} timeRange={timeRange} />}
    </div>
  );
}
