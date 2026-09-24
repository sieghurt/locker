import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from './auth/AuthContext';
import { RequireRole } from './auth/RequireRole';
import { Layout } from './components/Layout';
import { useLiveLockers } from './hooks';
import { AdminPage } from './pages/AdminPage';
import { AgentPage } from './pages/AgentPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { PickupPage } from './pages/PickupPage';

export default function App() {
  const { user } = useAuth();
  // The board needs a session; only subscribe once we have one.
  const { lockers, error, loading, status, feed, revision, refresh } = useLiveLockers(!!user);
  const pageProps = { lockers, loading, error, refresh: () => void refresh() };

  return (
    <Routes>
      <Route element={<Layout status={status} />}>
        <Route index element={<HomePage lockers={lockers} />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="agent"
          element={
            <RequireRole roles={['AGENT', 'ADMIN']}>
              <AgentPage {...pageProps} />
            </RequireRole>
          }
        />
        <Route
          path="pickup"
          element={
            <RequireRole roles={['CUSTOMER', 'ADMIN']}>
              <PickupPage {...pageProps} revision={revision} />
            </RequireRole>
          }
        />
        <Route
          path="admin"
          element={
            <RequireRole roles={['ADMIN']}>
              {user && <AdminPage {...pageProps} feed={feed} revision={revision} me={user} />}
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
