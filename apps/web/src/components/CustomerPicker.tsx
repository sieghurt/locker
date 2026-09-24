import { useEffect, useState } from 'react';

import { usersApi } from '../api/client';
import type { CustomerSummary } from '../api/types';

interface Props {
  value: CustomerSummary | null;
  onChange: (customer: CustomerSummary | null) => void;
}

/** Search-as-you-type over active customer accounts. Agents see names or masked emails, never full addresses. */
export function CustomerPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CustomerSummary[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (value) return;
    const q = query.trim();
    const timer = window.setTimeout(() => {
      setSearching(true);
      usersApi
        .customers(q)
        .then((r) => setResults(r.items))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [query, value]);

  if (value) {
    return (
      <div className="picked" data-testid="picked-customer">
        <span>
          <strong>{value.label}</strong> <span className="muted">{value.maskedEmail}</span>
        </span>
        <button type="button" className="link" onClick={() => onChange(null)}>
          change
        </button>
      </div>
    );
  }

  return (
    <div className="picker">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search customers by name or email"
        aria-label="Search customers"
        autoComplete="off"
      />
      <ul className="picker-results" aria-label="matching customers">
        {searching && results.length === 0 && <li className="muted">Searching…</li>}
        {!searching && results.length === 0 && (
          <li className="muted">No matching customer accounts.</li>
        )}
        {results.map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onChange(c)}>
              <strong>{c.label}</strong> <span className="muted">{c.maskedEmail}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
