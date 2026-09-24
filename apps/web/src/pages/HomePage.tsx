import { Navigate } from 'react-router-dom';

import { homeFor, useAuth } from '../auth/AuthContext';

import type { Locker } from '../api/types';

const roles = [
  {
    to: '/agent',
    title: 'Delivery agent',
    text: 'Store a package. The system picks the smallest free locker that fits and issues a pickup code.',
  },
  {
    to: '/pickup',
    title: 'Customer pickup',
    text: 'Enter your locker and pickup code to open the door and see any storage charge.',
  },
  {
    to: '/admin',
    title: 'Station admin',
    text: 'Manage lockers, watch occupancy live, and run the concurrency demo.',
  },
];

/** Landing: logged-in users go straight to their screen; visitors see what the system does and a login link. */
export function HomePage({ lockers }: { lockers: Locker[] }) {
  const { user } = useAuth();
  if (user) return <Navigate to={homeFor(user.role)} replace />;
  const free = lockers.filter((l) => l.status === 'AVAILABLE').length;
  return (
    <section className="home">
      <h2>Smart Package Locker</h2>
      <p className="muted">
        {user === undefined
          ? 'Checking your session…'
          : lockers.length > 0
            ? `${free} of ${lockers.length} lockers available right now.`
            : 'Delivery agents store packages, customers collect them with a code, admins run the station.'}
      </p>
      <div className="role-grid">
        {roles.map((r) => (
          <div key={r.to} className="role-card static">
            <h3>{r.title}</h3>
            <p>{r.text}</p>
          </div>
        ))}
      </div>
      <p>
        <a href="/login" className="button-link">
          Log in
        </a>
      </p>
    </section>
  );
}
