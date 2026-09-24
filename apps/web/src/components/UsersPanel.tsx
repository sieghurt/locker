import { FormEvent, useEffect, useState } from 'react';

import { describeError, usersApi } from '../api/client';
import type { User, UserRole } from '../api/types';

const ROLES: UserRole[] = ['ADMIN', 'AGENT', 'CUSTOMER'];

export function UsersPanel({ me }: { me: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<UserRole>('CUSTOMER');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    usersApi
      .list()
      .then((r) => setUsers(r.items))
      .catch((e: unknown) => setError(describeError(e)));

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await usersApi.create(email.trim(), role, displayName.trim());
      setEmail('');
      setDisplayName('');
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(user: User) {
    setError(null);
    try {
      await usersApi.update(user.id, { active: !user.active });
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  }

  async function changeRole(user: User, next: UserRole) {
    setError(null);
    try {
      await usersApi.update(user.id, { role: next });
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  }

  return (
    <section className="panel users" aria-labelledby="users-title">
      <header className="panel-header">
        <h2 id="users-title">Users</h2>
        <span className="muted">{users.length} accounts</span>
      </header>

      <form onSubmit={create} className="form inline-form">
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="new@example.com"
            required
          />
        </label>
        <label>
          Name
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="optional"
            maxLength={80}
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            {ROLES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="ghost" disabled={busy}>
          Add user
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <table className="users-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Name</th>
            <th>Role</th>
            <th>Last login</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const self = u.id === me.id;
            return (
              <tr key={u.id} className={u.active ? '' : 'inactive'}>
                <td>{u.email}</td>
                <td>{u.displayName ?? <span className="muted">—</span>}</td>
                <td>
                  <select
                    value={u.role}
                    disabled={self}
                    onChange={(e) => void changeRole(u, e.target.value as UserRole)}
                    aria-label={`role of ${u.email}`}
                  >
                    {ROLES.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </td>
                <td className="muted">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}
                </td>
                <td>
                  <button
                    type="button"
                    className="link"
                    disabled={self}
                    onClick={() => void toggleActive(u)}
                  >
                    {u.active ? 'deactivate' : 'reactivate'}
                  </button>
                  {self && <span className="muted small"> (you)</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
