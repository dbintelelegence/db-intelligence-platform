import { mockData } from '@/data/mock-data';
import { ExecutiveStateCard } from '@/components/features/overview/ExecutiveStateCard';
import { ContextStrip } from '@/components/features/overview/ContextStrip';
import { DatabaseStatusGrid } from '@/components/features/overview/DatabaseStatusGrid';
import { TopIssuesSection } from '@/components/features/overview/TopIssuesSection';
import { RecentChangesSection } from '@/components/features/overview/RecentChangesSection';
import { CostSnapshot } from '@/components/features/overview/CostSnapshot';

export function OverviewPage() {
  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="text-center mb-2">
        <h1 className="text-2xl font-bold tracking-tight text-muted-foreground">
          State of Your Database Platform
        </h1>
      </div>

      {/* Executive State Summary - The Hero */}
      <ExecutiveStateCard databases={mockData.databases} />

      {/* Immediate Context Strip */}
      <ContextStrip databases={mockData.databases} />

      {/* Global Database Status Grid */}
      <DatabaseStatusGrid databases={mockData.databases} />

      {/* Two Column Layout for Issues and Changes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Issues Right Now */}
        <TopIssuesSection databases={mockData.databases} />

        {/* What Changed Recently */}
        <RecentChangesSection databases={mockData.databases} />
      </div>

      {/* Cost Snapshot */}
      <CostSnapshot databases={mockData.databases} />
    </div>
  );
}
