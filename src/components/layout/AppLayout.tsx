import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { TabNavigation } from './TabNavigation';

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <TabNavigation />
      <main className="container px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
