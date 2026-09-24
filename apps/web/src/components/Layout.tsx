import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { SCREENS, useAuth } from '../auth/AuthContext';

import { LiveBadge } from './LiveBadge';
import type { LiveStatus } from '../hooks';

export function Layout({ status }: { status: LiveStatus }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const visible = user ? SCREENS.filter((screen) => screen.roles.includes(user.role)) : [];
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <span className="logo">▣</span> Smart Package Locker
        </NavLink>
        <nav className="nav" aria-label="roles">
          {visible.map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-right">
          {user && <LiveBadge status={status} />}
          {user ? (
            <span className="user-chip" data-testid="user-chip">
              <span className="muted">{user.role.toLowerCase()}</span>{' '}
              {user.displayName ?? user.email}
              <button
                type="button"
                className="link"
                onClick={() => {
                  void logout().then(() => navigate('/login'));
                }}
              >
                log out
              </button>
            </span>
          ) : (
            <NavLink to="/login" className="muted">
              Log in
            </NavLink>
          )}
          <a href="/api/docs" target="_blank" rel="noreferrer" className="muted">
            API docs ↗
          </a>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
