import { FormEvent, useEffect, useState } from 'react';

import { accountsApi, describeError } from '../api/client';
import type { Account, Statement } from '../api/types';
import { money } from '../money';
import { Modal } from './Modal';
import { TransactionList } from './TransactionList';

/** Admin view of the customer ledger: balances, one customer's history, and recording a payment. */
export function AccountsPanel({ version }: { version: number }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [totalBalance, setTotalBalance] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [history, setHistory] = useState<Statement | null>(null);
  const [payingFor, setPayingFor] = useState<Account | null>(null);

  useEffect(() => {
    let cancelled = false;
    accountsApi
      .list()
      .then((r) => {
        if (cancelled) return;
        setAccounts(r.items);
        setTotalBalance(r.totalBalance);
      })
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [version, reload]);

  const currency = accounts[0]?.currency ?? '';

  return (
    <section className="panel accounts" aria-labelledby="accounts-title">
      <header className="panel-header">
        <h2 id="accounts-title">Customer accounts</h2>
        <span className="muted" data-testid="total-balance">
          {money(totalBalance, currency)} owed in total
        </span>
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <table className="ledger-table">
        <thead>
          <tr>
            <th>Customer</th>
            <th>Charged</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>History</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.customerId}>
              <td>{a.customerLabel}</td>
              <td>{money(a.charged, a.currency)}</td>
              <td>{money(a.paid, a.currency)}</td>
              <td className={a.balance > 0 ? 'owed' : 'muted'}>{money(a.balance, a.currency)}</td>
              <td>
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    void accountsApi
                      .transactions(a.customerId)
                      .then((statement) => {
                        setPayingFor(null);
                        setHistory(statement);
                      })
                      .catch((e: unknown) => setError(describeError(e)))
                  }
                >
                  {a.transactions} shown
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setHistory(null);
                    setPayingFor(a);
                  }}
                >
                  record payment
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {accounts.length === 0 && !error && <p className="muted">No customer accounts yet.</p>}

      {history && (
        <Modal
          title={`${history.account.customerLabel}'s transactions`}
          onClose={() => setHistory(null)}
          testId="history-modal"
        >
          <p className="muted small">
            Balance {money(history.account.balance, history.account.currency)} · charged{' '}
            {money(history.account.charged, history.account.currency)} · paid{' '}
            {money(history.account.paid, history.account.currency)}
          </p>
          <TransactionList items={history.items} empty="Nothing on this account yet." />
        </Modal>
      )}

      {payingFor && (
        <PaymentModal
          account={payingFor}
          onClose={() => setPayingFor(null)}
          onRecorded={() => {
            setPayingFor(null);
            setReload((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}

function PaymentModal({
  account,
  onClose,
  onRecorded,
}: {
  account: Account;
  onClose: () => void;
  onRecorded: () => void;
}) {
  const [amount, setAmount] = useState(String(account.balance > 0 ? account.balance : ''));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await accountsApi.recordPayment(account.customerId, Number(amount), note);
      onRecorded();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Record a payment from ${account.customerLabel}`}
      onClose={onClose}
      testId="payment-modal"
    >
      <form onSubmit={submit} className="form">
        <p className="muted small">
          Owing {money(account.balance, account.currency)}. Recording a payment only updates the
          ledger; money is taken at the kiosk.
        </p>
        <label>
          Amount ({account.currency})
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          Note
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Cash at the kiosk"
            maxLength={160}
          />
        </label>
        <button type="submit" className="primary" disabled={busy || !amount}>
          {busy ? 'Recording…' : 'Record payment'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
