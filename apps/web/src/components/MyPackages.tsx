import { useEffect, useState } from 'react';

import { describeError, packagesApi } from '../api/client';
import type { Locker, PackageSummary } from '../api/types';
import { days, money } from '../money';

interface Props {
  lockers: Locker[];
  /** Bump to refetch (e.g. after a pickup or a live event). */
  version: number;
  onPick: (lockerId: string) => void;
}

/** A customer's own packages: what is waiting for them and where, plus their pickup history. */
export function MyPackages({ lockers, version, onPick }: Props) {
  const [items, setItems] = useState<PackageSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    packagesApi
      .mine()
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        setError(null);
      })
      // Never render "nothing is waiting" because the request failed: say so instead.
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const label = (lockerId: string) => lockers.find((l) => l.id === lockerId)?.label ?? '…';
  const waiting = (items ?? []).filter((p) => p.status === 'STORED');
  const totalOwed = waiting.reduce((sum, p) => sum + (p.charge?.amount ?? 0), 0);
  const currency = waiting.find((p) => p.charge)?.charge?.currency ?? '';
  const history = (items ?? []).filter((p) => p.status === 'RETRIEVED').slice(0, 5);

  return (
    <section className="panel" aria-labelledby="mine-title">
      <header className="panel-header">
        <h2 id="mine-title">My packages</h2>
        <span className="muted" data-testid="waiting-count">
          {items === null ? 'Loading…' : `${waiting.length} waiting`}
          {totalOwed > 0 && <> · {money(totalOwed, currency)} to pay</>}
        </span>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!error && items !== null && waiting.length === 0 && (
        <p className="muted">Nothing is waiting for you right now.</p>
      )}
      <ul className="mine-list">
        {waiting.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => onPick(p.lockerId)}>
              <span>
                Locker <strong>{label(p.lockerId)}</strong>{' '}
                <span className="muted">
                  · {p.size.toLowerCase()} · since {new Date(p.storedAt).toLocaleString()}
                </span>
              </span>
              {p.charge && (
                <span className="owed" data-testid="owed">
                  {money(p.charge.amount, p.charge.currency)}
                  <span className="muted small"> · {days(p.charge.chargedDays)}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {history.length > 0 && (
        <>
          <p className="code-label">Recently collected</p>
          <ul className="mine-list history">
            {history.map((p) => (
              <li key={p.id}>
                <span>
                  {new Date(p.retrievedAt!).toLocaleDateString()} · {p.size.toLowerCase()} · charged{' '}
                  {money(p.storageCharge ?? 0, p.charge?.currency ?? '')}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
