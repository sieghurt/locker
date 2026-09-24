import { FormEvent, useState } from 'react';

import { describeError, packagesApi } from '../api/client';
import type { Locker, RetrievedPackage } from '../api/types';

interface Props {
  lockers: Locker[];
  selectedLocker: Locker | null;
  onSelectLocker: (locker: Locker | null) => void;
  onRetrieved: () => void;
}

export function CustomerPanel({ lockers, selectedLocker, onSelectLocker, onRetrieved }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RetrievedPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selectedLocker) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const retrieved = await packagesApi.retrieve(selectedLocker.id, code.trim());
      setResult(retrieved);
      setCode('');
      onRetrieved();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="customer-title">
      <header className="panel-header">
        <h2 id="customer-title">Customer pickup</h2>
        <span className="muted">Locker + pickup code</span>
      </header>
      <p className="muted small">The pickup code was emailed to you when the package was stored.</p>

      <form onSubmit={submit} className="form">
        <label>
          Locker
          <select
            value={selectedLocker?.id ?? ''}
            onChange={(e) => onSelectLocker(lockers.find((l) => l.id === e.target.value) ?? null)}
            required
          >
            <option value="" disabled>
              Choose a locker…
            </option>
            {lockers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label} · {l.size} · {l.status === 'OCCUPIED' ? 'occupied' : 'free'}
              </option>
            ))}
          </select>
        </label>
        <label>
          Pickup code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 digits"
            pattern="\d{4,12}"
            required
            className="code-input"
          />
        </label>
        <button type="submit" className="primary" disabled={busy || !selectedLocker}>
          {busy ? 'Checking…' : 'Open locker'}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="receipt" role="status">
          <p className="opened">
            Locker <strong>{result.lockerLabel}</strong> is open. Take your package.
          </p>
          <ChargeTable result={result} />
        </div>
      )}
    </section>
  );
}

function ChargeTable({ result }: { result: RetrievedPackage }) {
  const { storageCharge: c } = result;
  return (
    <div className="charge">
      <p>
        Stored {c.totalDays} day{c.totalDays === 1 ? '' : 's'}
        {c.freeDays > 0 ? ` (${c.freeDays} free)` : ''} · charged {c.chargedDays}
      </p>
      {c.breakdown.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Days</th>
              <th>Rate / day</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {c.breakdown.map((t) => (
              <tr key={t.tier}>
                <td>{t.tier}</td>
                <td>{t.days}</td>
                <td>{t.ratePerDay}</td>
                <td>{t.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="total" data-testid="charge-total">
        Storage charge: <strong>{c.amount}</strong> {c.currency}
      </p>
    </div>
  );
}
