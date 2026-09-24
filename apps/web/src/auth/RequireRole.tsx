import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import type { UserRole } from '../api/types';
import { homeFor, useAuth } from './AuthContext';

/** Gate for a route: logged out -> /login (remembering where they were); wrong role -> their own home. */
export function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  if (user === undefined) return <p className="muted center">Checking your session…</p>;
  if (user === null) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}
