import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Locker, RetrievedPackage } from '../api/types';
import { CustomerPanel } from './CustomerPanel';

const locker: Locker = {
  id: '11111111-1111-4111-8111-111111111111',
  label: 'S-01',
  size: 'SMALL',
  status: 'OCCUPIED',
  createdAt: '2026-01-01T00:00:00.000Z',
  currentPackage: {
    id: 'p1',
    size: 'SMALL',
    customerLabel: 'Alice',
    storedAt: '2026-01-01T00:00:00.000Z',
  },
};

const retrieved: RetrievedPackage = {
  packageId: 'p1',
  lockerId: locker.id,
  lockerLabel: 'S-01',
  lockerOpened: true,
  storedAt: '2026-01-01T00:00:00.000Z',
  retrievedAt: '2026-01-08T00:00:00.000Z',
  storageCharge: {
    currency: 'UNITS',
    totalDays: 7,
    freeDays: 0,
    chargedDays: 7,
    amount: 90,
    breakdown: [
      { tier: 1, days: 5, ratePerDay: 10, amount: 50 },
      { tier: 2, days: 2, ratePerDay: 20, amount: 40 },
    ],
  },
};

const envelope = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('CustomerPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  it('submits locker id + code and shows the charge breakdown on success', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(envelope(200, { success: true, data: retrieved }));
    const onRetrieved = vi.fn();

    render(
      <CustomerPanel
        lockers={[locker]}
        selectedLocker={locker}
        onSelectLocker={() => {}}
        onRetrieved={onRetrieved}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('6 digits'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: /open locker/i }));

    await waitFor(() => expect(screen.getByTestId('charge-total')).toHaveTextContent('90'));
    expect(screen.getByText(/is open/i)).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 tiers
    expect(onRetrieved).toHaveBeenCalled();

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({ lockerId: locker.id, pickupCode: '482913' });
  });

  it('shows the kiosk wording for a wrong code and keeps the form usable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      envelope(403, { success: false, error: { code: 'INVALID_PICKUP_CODE', message: 'nope' } }),
    );

    render(
      <CustomerPanel
        lockers={[locker]}
        selectedLocker={locker}
        onSelectLocker={() => {}}
        onRetrieved={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('6 digits'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: /open locker/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/does not match/));
    expect(screen.getByRole('button', { name: /open locker/i })).toBeEnabled();
  });

  it('disables the submit button until a locker is selected', () => {
    render(
      <CustomerPanel
        lockers={[locker]}
        selectedLocker={null}
        onSelectLocker={() => {}}
        onRetrieved={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /open locker/i })).toBeDisabled();
  });
});
