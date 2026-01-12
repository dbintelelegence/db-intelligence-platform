import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { TabNavigation } from './TabNavigation';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="flex">
        <TabNavigation />
        <main className="flex-1 px-6 py-8 overflow-x-auto">
          <div className="max-w-[1400px] mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
