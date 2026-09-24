import { useState } from 'react';

import type { Locker, LockerEvent, User } from '../api/types';
import { LOCKER_SIZES } from '../api/types';
import { AccountsPanel } from '../components/AccountsPanel';
import { ChargesPanel } from '../components/ChargesPanel';
import { LockerBoard } from '../components/LockerBoard';
import { OperatorPanel } from '../components/OperatorPanel';
import { UsersPanel } from '../components/UsersPanel';
import { LockerAssist } from '../components/LockerAssist';

interface Props {
  lockers: Locker[];
  loading: boolean;
  error: string | null;
  feed: LockerEvent[];
  revision: number;
  refresh: () => void;
  me: User;
}

const eventCopy: Record<LockerEvent['type'], string> = {
  'locker.created': 'Locker added',
  'package.stored': 'Package stored',
  'package.retrieved': 'Package collected',
};

export function AdminPage({ lockers, loading, error, feed, revision, refresh, me }: Props) {
  const occupied = lockers.filter((l) => l.status === 'OCCUPIED').length;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = lockers.find((l) => l.id === selectedId) ?? null;
  return (
    <div className="admin">
      <section className="stats" aria-label="occupancy">
        <div className="stat">
          <span className="stat-value" data-testid="stat-total">
            {lockers.length}
          </span>
          <span className="stat-label">lockers</span>
        </div>
        <div className="stat">
          <span className="stat-value" data-testid="stat-available">
            {lockers.length - occupied}
          </span>
          <span className="stat-label">available</span>
        </div>
        <div className="stat">
          <span className="stat-value" data-testid="stat-occupied">
            {occupied}
          </span>
          <span className="stat-label">occupied</span>
        </div>
        {LOCKER_SIZES.map((size) => {
          const ofSize = lockers.filter((l) => l.size === size);
          const free = ofSize.filter((l) => l.status === 'AVAILABLE').length;
          return (
            <div className="stat" key={size}>
              <span className="stat-value">
                {free}
                <span className="muted">/{ofSize.length}</span>
              </span>
              <span className="stat-label">{size.toLowerCase()} free</span>
            </div>
          );
        })}
      </section>

      <div className="admin-rows">
        <LockerBoard
          lockers={lockers}
          loading={loading}
          error={error}
          selectedId={selectedId}
          onSelect={(l) => setSelectedId(l.id)}
          hint="Click a locker to see what is inside and, if needed, its pickup code."
        />
        <ChargesPanel version={revision} />
        <AccountsPanel version={revision} />
        <OperatorPanel onChanged={refresh} />
        <section className="panel feed" aria-labelledby="feed-title">
          <header className="panel-header">
            <h2 id="feed-title">Live activity</h2>
            <span className="muted">latest first</span>
          </header>
          {feed.length === 0 ? (
            <p className="muted">
              Nothing yet. Store or collect a package from another screen and it shows up here.
            </p>
          ) : (
            <ul className="feed-list">
              {feed.map((e, i) => (
                <li key={`${e.at}-${e.lockerId}-${i}`} className={e.type}>
                  <time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time>
                  <span className="feed-what">{eventCopy[e.type]}</span>
                  <span className="feed-where">
                    {e.lockerLabel} <span className="muted">({e.lockerSize.toLowerCase()})</span>
                    {e.customerLabel ? <span className="muted"> · {e.customerLabel}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <UsersPanel me={me} />
      </div>

      {/* Keyed so picking another locker starts a fresh panel rather than reusing the last reveal. */}
      <LockerAssist
        key={selectedId ?? 'none'}
        locker={selected}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
