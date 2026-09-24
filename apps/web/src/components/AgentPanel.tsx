import { FormEvent, useState } from 'react';

import { describeError, packagesApi } from '../api/client';
import {
  LOCKER_SIZES,
  type CustomerSummary,
  type LockerSize,
  type StoredPackage,
} from '../api/types';
import { CustomerPicker } from './CustomerPicker';

interface Props {
  onStored: () => void;
  /** Admins may reveal the pickup code on screen to help a customer; agents never see it. */
  canRevealCode?: boolean;
}

export function AgentPanel({ onStored, canRevealCode = false }: Props) {
  const [size, setSize] = useState<LockerSize>('SMALL');
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StoredPackage | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!customer) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setRevealed(false);
    try {
      const stored = await packagesApi.store(size, customer.id);
      setResult(stored);
      setCustomer(null);
      onStored();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="agent-title">
      <header className="panel-header">
        <h2 id="agent-title">Delivery agent</h2>
        <span className="muted">Store a package</span>
      </header>

      <form onSubmit={submit} className="form">
        <div className="field">
          <span className="field-label" id="package-size-label">
            Package size
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="package-size-label">
            {LOCKER_SIZES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={size === s}
                // Roving tabindex: the group is one tab stop, arrows move within it.
                tabIndex={size === s ? 0 : -1}
                className={size === s ? 'on' : ''}
                onClick={() => setSize(s)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                  event.preventDefault();
                  const step = event.key === 'ArrowRight' ? 1 : -1;
                  const next =
                    LOCKER_SIZES[
                      (LOCKER_SIZES.indexOf(size) + step + LOCKER_SIZES.length) %
                        LOCKER_SIZES.length
                    ];
                  setSize(next);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <label>
          Customer
          <CustomerPicker value={customer} onChange={setCustomer} />
        </label>
        <button type="submit" className="primary" disabled={busy || !customer}>
          {busy ? 'Finding a locker…' : 'Store package'}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="receipt" role="status">
          <p>
            Stored in locker <strong>{result.lockerLabel}</strong>{' '}
            <span className="muted">
              ({result.lockerSize} locker, {result.packageSize} package) for{' '}
              <strong>{result.customer.label}</strong>
            </span>
          </p>
          <p className={result.notified ? 'opened' : 'error'}>
            {result.notified
              ? 'Pickup code emailed to the customer.'
              : 'Could not email the pickup code. Give it to the customer another way.'}
          </p>
          {canRevealCode && result.pickupCode && (
            <>
              <p className="code-label">Pickup code (admin view)</p>
              {revealed ? (
                <p className="code" data-testid="pickup-code">
                  {result.pickupCode}
                </p>
              ) : (
                <button type="button" className="ghost" onClick={() => setRevealed(true)}>
                  Reveal code
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
