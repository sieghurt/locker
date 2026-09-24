import { FormEvent, useState } from 'react';

import { ApiError, describeError, lockersApi, packagesApi, usersApi } from '../api/client';
import { LOCKER_SIZES, type LockerSize } from '../api/types';

interface Props {
  onChanged: () => void;
}

interface BurstResult {
  requested: number;
  stored: number;
  rejected: number;
  failed: number;
  distinctLockers: number;
}

/** Station operator tools: add lockers, and demonstrate Level 4 with a concurrent burst. */
export function OperatorPanel({ onChanged }: Props) {
  const [label, setLabel] = useState('');
  const [size, setSize] = useState<LockerSize>('SMALL');
  const [createError, setCreateError] = useState<string | null>(null);

  const [burstCount, setBurstCount] = useState(20);
  const [burstBusy, setBurstBusy] = useState(false);
  const [burst, setBurst] = useState<BurstResult | null>(null);
  const [burstError, setBurstError] = useState<string | null>(null);

  async function createLocker(event: FormEvent) {
    event.preventDefault();
    setCreateError(null);
    try {
      await lockersApi.create(label.trim(), size);
      setLabel('');
      onChanged();
    } catch (e) {
      setCreateError(describeError(e));
    }
  }

  async function runBurst() {
    setBurstBusy(true);
    setBurst(null);
    setBurstError(null);
    try {
      // Packages are addressed to a customer account, so the demo needs a real one to store for.
      const { items } = await usersApi.customers('');
      const customer = items[0];
      if (!customer) {
        setBurstError('Add a customer account first: every package is stored for a customer.');
        return;
      }

      const outcomes = await Promise.all(
        Array.from({ length: burstCount }, () =>
          packagesApi
            .store('SMALL', customer.id)
            .then((r) => ({ kind: 'stored' as const, lockerId: r.lockerId }))
            .catch((e: unknown) => ({
              kind:
                e instanceof ApiError && e.code === 'NO_SUITABLE_LOCKER'
                  ? ('rejected' as const)
                  : ('failed' as const),
            })),
        ),
      );
      const stored = outcomes.filter((o) => o.kind === 'stored');
      setBurst({
        requested: burstCount,
        stored: stored.length,
        rejected: outcomes.filter((o) => o.kind === 'rejected').length,
        failed: outcomes.filter((o) => o.kind === 'failed').length,
        distinctLockers: new Set(stored.map((o) => ('lockerId' in o ? o.lockerId : undefined)))
          .size,
      });
      onChanged();
    } catch (e) {
      setBurstError(describeError(e));
    } finally {
      setBurstBusy(false);
    }
  }

  return (
    <section className="panel operator" aria-labelledby="operator-title">
      <header className="panel-header">
        <h2 id="operator-title">Station operator</h2>
        <span className="muted">Inventory and concurrency demo</span>
      </header>

      <div className="two-col">
        <form onSubmit={createLocker} className="form">
          <label>
            New locker label
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="A-01"
              required
              maxLength={32}
              pattern="[A-Za-z0-9][A-Za-z0-9 _-]*"
            />
          </label>
          <label>
            Size
            <select value={size} onChange={(e) => setSize(e.target.value as LockerSize)}>
              {LOCKER_SIZES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="ghost">
            Add locker
          </button>
          {createError && (
            <p className="error" role="alert">
              {createError}
            </p>
          )}
        </form>

        <div className="form">
          <label>
            Concurrent SMALL packages
            <input
              type="number"
              min={1}
              max={200}
              value={burstCount}
              onChange={(e) => setBurstCount(Number(e.target.value))}
            />
          </label>
          <button
            type="button"
            className="ghost"
            onClick={() => void runBurst()}
            disabled={burstBusy}
          >
            {burstBusy ? 'Storing…' : 'Fire burst'}
          </button>
          <p className="muted small">
            Fires every request at once. Exactly one package per free locker should succeed; the
            rest get “no suitable locker”.
          </p>
          {burstError && (
            <p className="error" role="alert">
              {burstError}
            </p>
          )}
          {burst && (
            <p className="burst" data-testid="burst-result">
              {burst.requested} requests → <strong>{burst.stored}</strong> stored in{' '}
              <strong>{burst.distinctLockers}</strong> distinct lockers, {burst.rejected} rejected
              {burst.failed > 0 ? `, ${burst.failed} failed` : ''}.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
