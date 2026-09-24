import { useEffect, useState } from 'react';

import { accountsApi, describeError } from '../api/client';
import type { Statement } from '../api/types';
import { money } from '../money';
import { TransactionList } from './TransactionList';

/** The customer's own balance and history: what they have been charged, what they paid, what is left. */
export function MyAccount({ version }: { version: number }) {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    accountsApi
      .myTransactions()
      .then((s) => !cancelled && setStatement(s))
      .catch((e: unknown) => !cancelled && setError(describeError(e)));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const account = statement?.account;

  return (
    <section className="panel" aria-labelledby="account-title">
      <header className="panel-header">
        <h2 id="account-title">My account</h2>
        {account && (
          <span className={account.balance > 0 ? 'owed' : 'muted'} data-testid="balance">
            {account.balance > 0
              ? `${money(account.balance, account.currency)} due`
              : 'nothing due'}
          </span>
        )}
      </header>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {account && (
        <>
          <p className="muted small">
            Charged {money(account.charged, account.currency)} · paid{' '}
            {money(account.paid, account.currency)} over {account.transactions} transaction
            {account.transactions === 1 ? '' : 's'}.
          </p>
          <TransactionList
            items={statement.items}
            empty="No transactions yet. Storage is charged when you collect a package."
          />
        </>
      )}
    </section>
  );
}
