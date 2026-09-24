import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, mockApi } from '../test/mock-api';
import { MyAccount } from './MyAccount';

const statement = {
  account: {
    customerId: 'u-alice',
    customerLabel: 'Alice',
    currency: 'UNITS',
    balance: 50,
    charged: 90,
    paid: 40,
    transactions: 2,
  },
  items: [
    {
      id: 't2',
      type: 'PAYMENT',
      amount: -40,
      currency: 'UNITS',
      description: 'Cash at the kiosk',
      packageId: null,
      occurredAt: '2026-01-08T00:00:00.000Z',
    },
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
  total: 2,
  limit: 20,
  offset: 0,
};

describe('MyAccount', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the balance and the history, newest first, with signs', async () => {
    mockApi({ '/api/accounts/me/transactions': () => envelope(200, statement) });
    render(<MyAccount version={0} />);

    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('50.00 UNITS due'));
    expect(
      screen.getByText(/Charged 90.00 UNITS · paid 40.00 UNITS over 2 transactions/),
    ).toBeInTheDocument();

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Cash at the kiosk');
    expect(rows[0]).toHaveTextContent('−40.00 UNITS');
    expect(rows[1]).toHaveTextContent('+90.00 UNITS');
  });

  it('says nothing is due on a settled account with no history', async () => {
    mockApi({
      '/api/accounts/me/transactions': () =>
        envelope(200, {
          ...statement,
          account: { ...statement.account, balance: 0, charged: 0, paid: 0, transactions: 0 },
          items: [],
          total: 0,
        }),
    });
    render(<MyAccount version={0} />);
    await waitFor(() => expect(screen.getByTestId('balance')).toHaveTextContent('nothing due'));
    expect(screen.getByText(/No transactions yet/)).toBeInTheDocument();
  });
});
