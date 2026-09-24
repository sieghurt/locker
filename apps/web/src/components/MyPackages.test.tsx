import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Locker, PackageSummary } from '../api/types';
import { envelope, failure, mockApi } from '../test/mock-api';
import { MyPackages } from './MyPackages';

const locker: Locker = {
  id: 'l1',
  label: 'S-01',
  size: 'SMALL',
  status: 'OCCUPIED',
  createdAt: '2026-01-01T00:00:00.000Z',
  currentPackage: null,
};

const waiting: PackageSummary = {
  id: 'p1',
  lockerId: 'l1',
  size: 'SMALL',
  customerUserId: 'u-alice',
  status: 'STORED',
  storedAt: '2026-01-01T00:00:00.000Z',
  retrievedAt: null,
  storageCharge: null,
  chargedDays: null,
  charge: {
    currency: 'UNITS',
    totalDays: 7,
    freeDays: 0,
    chargedDays: 7,
    amount: 90,
    breakdown: [],
  },
};

const collected: PackageSummary = {
  ...waiting,
  id: 'p0',
  status: 'RETRIEVED',
  retrievedAt: '2026-01-05T00:00:00.000Z',
  storageCharge: 40,
  chargedDays: 4,
  charge: {
    currency: 'UNITS',
    totalDays: 4,
    freeDays: 0,
    chargedDays: 4,
    amount: 40,
    breakdown: [],
  },
};

describe('MyPackages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows what each waiting package owes, and the total to pay', async () => {
    mockApi({ '/api/packages/mine': () => envelope(200, [waiting, collected]) });
    render(<MyPackages lockers={[locker]} version={0} onPick={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('owed')).toHaveTextContent('90.00 UNITS'));
    expect(screen.getByTestId('owed')).toHaveTextContent('7 days');
    expect(screen.getByTestId('waiting-count')).toHaveTextContent('1 waiting · 90.00 UNITS to pay');
    expect(screen.getByText(/charged 40.00 UNITS/)).toBeInTheDocument();
  });

  it('says nothing is waiting when the list is empty', async () => {
    mockApi({ '/api/packages/mine': () => envelope(200, []) });
    render(<MyPackages lockers={[locker]} version={0} onPick={() => {}} />);
    await waitFor(() => expect(screen.getByText(/nothing is waiting/i)).toBeInTheDocument());
    expect(screen.queryByTestId('owed')).not.toBeInTheDocument();
  });

  it('reports a failed load instead of saying nothing is waiting', async () => {
    mockApi({ '/api/packages/mine': () => failure(500, 'INTERNAL_ERROR', 'boom') });
    render(<MyPackages lockers={[locker]} version={0} onPick={() => {}} />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText(/nothing is waiting/i)).not.toBeInTheDocument();
  });
});
