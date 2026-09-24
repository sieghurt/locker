import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, mockApi } from '../test/mock-api';
import { AccountsPanel } from './AccountsPanel';

const alice = {
  customerId: 'u-alice',
  customerLabel: 'Alice',
  currency: 'UNITS',
  balance: 50,
  charged: 90,
  paid: 40,
  transactions: 2,
};
const bob = {
  ...alice,
  customerId: 'u-bob',
  customerLabel: 'Bob',
  balance: 0,
  charged: 0,
  paid: 0,
  transactions: 0,
};

describe('AccountsPanel (admin)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists every customer balance and the total owed', async () => {
    mockApi({
      '/api/accounts': () => envelope(200, { items: [alice, bob], total: 2, totalBalance: 50 }),
    });
    render(<AccountsPanel version={0} />);

    await waitFor(() =>
      expect(screen.getByTestId('total-balance')).toHaveTextContent('50.00 UNITS owed in total'),
    );
    const rows = screen.getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Alice');
    expect(rows[1]).toHaveTextContent('90.00 UNITS');
    expect(rows[2]).toHaveTextContent('Bob');
  });

  it('opens one customer history in a popup', async () => {
    mockApi({
      '/api/accounts': () => envelope(200, { items: [alice], total: 1, totalBalance: 50 }),
      '/api/accounts/u-alice/transactions': () =>
        envelope(200, {
          account: alice,
          items: [
            {
              id: 't1',
              type: 'CHARGE',
              amount: 90,
              currency: 'UNITS',
              description: 'Storage for 7 day(s) in locker S-01',
              packageId: 'p1',
              occurredAt: '2026-01-07T00:00:00.000Z',
            },
          ],
          total: 1,
          limit: 50,
          offset: 0,
        }),
    });
    render(<AccountsPanel version={0} />);

    fireEvent.click(await screen.findByRole('button', { name: /2 shown/ }));
    await waitFor(() => expect(screen.getByTestId('history-modal')).toBeInTheDocument());
    expect(screen.getByText(/Storage for 7 day\(s\) in locker S-01/)).toBeInTheDocument();
  });

  it('records a payment, pre-filled with the balance, and refreshes the table', async () => {
    const fetchMock = mockApi({
      '/api/accounts': () => envelope(200, { items: [alice], total: 1, totalBalance: 50 }),
      'POST /api/accounts/u-alice/payments': () =>
        envelope(201, {
          id: 't3',
          type: 'PAYMENT',
          amount: -50,
          currency: 'UNITS',
          description: 'Cash at the kiosk',
          packageId: null,
          occurredAt: '2026-01-09T00:00:00.000Z',
        }),
    });
    render(<AccountsPanel version={0} />);

    fireEvent.click(await screen.findByRole('button', { name: /record payment/ }));
    const modal = await screen.findByTestId('payment-modal');
    expect(modal).toHaveTextContent('Owing 50.00 UNITS');
    expect(screen.getByLabelText(/Amount/)).toHaveValue(50);

    fireEvent.change(screen.getByPlaceholderText('Cash at the kiosk'), {
      target: { value: 'Card' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: /^record payment$/i }));

    await waitFor(() => expect(screen.queryByTestId('payment-modal')).not.toBeInTheDocument());
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).includes('/payments') && init?.method === 'POST',
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ amount: 50, note: 'Card' });
  });
});
