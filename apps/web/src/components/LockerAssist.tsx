import { useState } from 'react';

import { describeError, lockersApi } from '../api/client';
import type { Locker, RevealedPickupCode } from '../api/types';
import { days, money } from '../money';
import { Modal } from './Modal';

interface Props {
  locker: Locker | null;
  onClose: () => void;
}

/**
 * Admin assistance for one locker, shown as a popup: what is inside and, on request, the pickup code
 * to read out to a customer who cannot reach their email. Each reveal is logged by the API.
 */
export function LockerAssist({ locker, onClose }: Props) {
  const [revealed, setRevealed] = useState<RevealedPickupCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lockerId = locker?.id;

  if (!locker) return null;

  async function reveal() {
    if (!lockerId) return;
    setBusy(true);
    setError(null);
    try {
      setRevealed(await lockersApi.revealPickupCode(lockerId));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      testId="locker-assist"
      onClose={onClose}
      title={
        <>
          Locker {locker.label} <span className="muted">· {locker.size.toLowerCase()}</span>
        </>
      }
    >
      {locker.status === 'AVAILABLE' ? (
        <p className="muted">This locker is free.</p>
      ) : (
        <>
          <p>
            Holding a <strong>{locker.currentPackage?.size.toLowerCase()}</strong> package for{' '}
            <strong>{locker.currentPackage?.customerLabel}</strong>
            {locker.currentPackage && (
              <span className="muted">
                {' '}
                since {new Date(locker.currentPackage.storedAt).toLocaleString()}
              </span>
            )}
            .
          </p>
          {locker.currentPackage?.accruedCharge && (
            <p data-testid="accrued-charge">
              Owes{' '}
              <strong>
                {money(
                  locker.currentPackage.accruedCharge.amount,
                  locker.currentPackage.accruedCharge.currency,
                )}
              </strong>{' '}
              <span className="muted">
                so far · {days(locker.currentPackage.accruedCharge.chargedDays)}
              </span>
            </p>
          )}
          {revealed ? (
            <div className="receipt" role="status">
              <p className="code-label">Pickup code for {revealed.customerLabel}</p>
              <p className="code" data-testid="revealed-code">
                {revealed.pickupCode}
              </p>
              <p className="muted small">
                Read it out to the customer only after confirming who they are. This reveal is
                logged.
              </p>
            </div>
          ) : (
            <button type="button" className="primary" onClick={() => void reveal()} disabled={busy}>
              {busy ? 'Fetching…' : 'Show pickup code'}
            </button>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
