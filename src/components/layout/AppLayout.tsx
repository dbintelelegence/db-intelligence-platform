import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { TabNavigation } from './TabNavigation';
import { CommandPalette } from './CommandPalette';
import { SummarizationPanel } from '@/components/features/summarization/SummarizationPanel';

export function AppLayout() {
  const [showAI, setShowAI] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <Header onOpenAI={() => setShowAI(true)} />
      <div className="flex">
        <TabNavigation />
        <main className="flex-1 px-6 py-8 overflow-x-auto">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      {showAI && <SummarizationPanel onClose={() => setShowAI(false)} />}
    </div>
  );
}
