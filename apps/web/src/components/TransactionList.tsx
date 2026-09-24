import type { Transaction } from '../api/types';
import { money } from '../money';

/** A ledger, newest first. Charges add to what is owed; payments settle it. */
export function TransactionList({ items, empty }: { items: Transaction[]; empty: string }) {
  if (items.length === 0) return <p className="muted">{empty}</p>;

  return (
    <ul className="ledger" aria-label="transactions">
      {items.map((t) => (
        <li key={t.id} className={t.type.toLowerCase()}>
          <time dateTime={t.occurredAt}>{new Date(t.occurredAt).toLocaleDateString()}</time>
          <span className="ledger-what">{t.description}</span>
          <span className="ledger-amount">
            {t.amount < 0 ? '−' : '+'}
            {money(Math.abs(t.amount), t.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}
