import { useEffect, useState } from 'react';

import { describeError, packagesApi } from '../api/client';
import type { ChargesSummary } from '../api/types';
import { money } from '../money';

/** What the station is owed on packages still in lockers, and what it has charged on collection. */
export function ChargesPanel({ version }: { version: number }) {
  const [summary, setSummary] = useState<ChargesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    packagesApi
      .charges()
      .then((s) => !cancelled && setSummary(s))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  return (
    <section className="panel charges" aria-labelledby="charges-title">
      <header className="panel-header">
        <h2 id="charges-title">Storage charges</h2>
        <span className="muted">what customers owe, and what has been charged</span>
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {summary && (
        <div className="stats">
          <div className="stat">
            <span className="stat-value" data-testid="outstanding-amount">
              {money(summary.outstanding.amount, summary.currency)}
            </span>
            <span className="stat-label">to pay · {summary.outstanding.packages} in lockers</span>
          </div>
          <div className="stat">
            <span className="stat-value" data-testid="collected-amount">
              {money(summary.collected.amount, summary.currency)}
            </span>
            <span className="stat-label">charged · {summary.collected.packages} collected</span>
          </div>
        </div>
      )}
      <p className="muted small">
        A waiting package&apos;s amount keeps growing until it is collected; the charge recorded
        against a package is the one calculated at collection.
      </p>
    </section>
  );
}
