import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ApiError, authApi, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  /** undefined while the session is being checked, null when logged out. */
  user: User | null | undefined;
  login: (email: string, code: string) => Promise<User>;
  /** Resolves to the code itself only when the server is in demo mode. */
  requestCode: (email: string) => Promise<string | undefined>;
  logout: () => Promise<void>;
  /** Called by the API client's callers on a 401 so the app drops to the login screen. */
  sessionEnded: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    // A 401 means logged out. A network error means we cannot tell yet, so try once more before
    // sending someone with a perfectly good cookie to the login screen.
    const load = (retryOnNetworkError: boolean) => {
      authApi
        .me()
        .then((me) => !cancelled && setUser(me))
        .catch((e: unknown) => {
          if (cancelled) return;
          if (retryOnNetworkError && e instanceof ApiError && e.code === 'NETWORK_ERROR') {
            window.setTimeout(() => !cancelled && load(false), 1000);
            return;
          }
          setUser(null);
        });
    };
    load(true);
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from any request ends the session here, so the guards can redirect.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    return () => setUnauthorizedHandler(undefined);
  }, []);

  const requestCode = useCallback(async (email: string) => {
    const res = await authApi.requestCode(email);
    return res.demoCode;
  }, []);

  const login = useCallback(async (email: string, code: string) => {
    const me = await authApi.verifyCode(email, code);
    setUser(me);
    return me;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // The cookie may already be gone, or the API unreachable; either way this session is over here.
    } finally {
      setUser(null);
    }
  }, []);

  const sessionEnded = useCallback(() => setUser(null), []);

  const value = useMemo(
    () => ({ user, login, requestCode, logout, sessionEnded }),
    [user, login, requestCode, logout, sessionEnded],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Which roles may use which screen. The navigation, the route guards and the login redirect share it. */
export const SCREENS: Array<{ to: string; label: string; roles: Array<User['role']> }> = [
  { to: '/agent', label: 'Delivery agent', roles: ['AGENT', 'ADMIN'] },
  { to: '/pickup', label: 'Customer pickup', roles: ['CUSTOMER', 'ADMIN'] },
  { to: '/admin', label: 'Station admin', roles: ['ADMIN'] },
];

/** Where each role lands after login. */
export function homeFor(role: User['role']): string {
  return role === 'ADMIN' ? '/admin' : role === 'AGENT' ? '/agent' : '/pickup';
}

export function canUse(role: User['role'], path: string): boolean {
  return SCREENS.some((screen) => screen.to === path && screen.roles.includes(role));
}
