import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { OverviewPage } from './pages/OverviewPage';
import { DatabasesPage } from './pages/DatabasesPage';
import { DatabaseDetailPage } from './pages/DatabaseDetailPage';
import { IssuesPage } from './pages/IssuesPage';
import { BillingPage } from './pages/BillingPage';
import { AlertsPage } from './pages/AlertsPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <OverviewPage />,
      },
      {
        path: 'databases',
        element: <DatabasesPage />,
      },
      {
        path: 'databases/:id',
        element: <DatabaseDetailPage />,
      },
      {
        path: 'issues',
        element: <IssuesPage />,
      },
      {
        path: 'billing',
        element: <BillingPage />,
      },
      {
        path: 'alerts',
        element: <AlertsPage />,
      },
    ],
  },
]);
