/** One place for how amounts are written, so every screen says it the same way. */
export function money(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100;
  // Always two decimals: a ledger reads badly with "10.5" next to "123.46".
  return `${rounded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function days(count: number): string {
  return `${count} day${count === 1 ? '' : 's'}`;
}
