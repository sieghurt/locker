import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Locker } from '../api/types';
import { envelope, failure, mockApi } from '../test/mock-api';
import { LockerAssist } from './LockerAssist';

const occupied: Locker = {
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
    accruedCharge: { amount: 30, chargedDays: 3, currency: 'UNITS' },
  },
};

describe('LockerAssist (admin)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows who the package is for and reveals the code on request', async () => {
    mockApi({
      [`/api/lockers/${occupied.id}/pickup-code`]: () =>
        envelope(200, { lockerLabel: 'S-01', customerLabel: 'Alice', pickupCode: '482913' }),
    });
    render(<LockerAssist locker={occupied} onClose={() => {}} />);
    expect(screen.getByText(/package for/)).toHaveTextContent('Alice');
    expect(screen.getByTestId('accrued-charge')).toHaveTextContent('30.00 UNITS');
    expect(screen.queryByTestId('revealed-code')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show pickup code/i }));
    await waitFor(() => expect(screen.getByTestId('revealed-code')).toHaveTextContent('482913'));
  });

  it('explains when the code cannot be recovered', async () => {
    mockApi({
      [`/api/lockers/${occupied.id}/pickup-code`]: () =>
        failure(409, 'PICKUP_CODE_UNAVAILABLE', 'stored before codes became recoverable'),
    });
    render(<LockerAssist locker={occupied} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /show pickup code/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/recoverable/));
  });

  it('closes on Escape, on a backdrop click and on the close button', () => {
    mockApi({});
    const onClose = vi.fn();
    render(<LockerAssist locker={occupied} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('says so for a free locker and renders nothing without a selection', () => {
    const { rerender } = render(
      <LockerAssist
        locker={{ ...occupied, status: 'AVAILABLE', currentPackage: null }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/this locker is free/i)).toBeInTheDocument();
    rerender(<LockerAssist locker={null} onClose={() => {}} />);
    expect(screen.queryByTestId('locker-assist')).not.toBeInTheDocument();
  });
});
