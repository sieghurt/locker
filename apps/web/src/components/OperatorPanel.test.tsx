import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, failure, mockApi } from '../test/mock-api';
import { OperatorPanel } from './OperatorPanel';

const customers = {
  items: [{ id: 'u-alice', label: 'Alice', maskedEmail: 'al***@test.local' }],
  total: 1,
};

describe('OperatorPanel burst demo', () => {
  afterEach(() => vi.restoreAllMocks());

  it('stores for a real customer account and counts wins, rejections and failures apart', async () => {
    let call = 0;
    const fetchMock = mockApi({
      '/api/users/customers': () => envelope(200, customers),
      'POST /api/packages': () => {
        call += 1;
        // Two lockers free, then the station is full.
        return call <= 2
          ? envelope(201, { lockerId: `locker-${call}` })
          : failure(409, 'NO_SUITABLE_LOCKER', 'nothing fits');
      },
    });
    render(<OperatorPanel onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText(/Concurrent SMALL packages/i), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByRole('button', { name: /fire burst/i }));

    await waitFor(() => expect(screen.getByTestId('burst-result')).toBeInTheDocument());
    const result = screen.getByTestId('burst-result');
    expect(result).toHaveTextContent('5 requests');
    expect(result).toHaveTextContent('2 stored');
    expect(result).toHaveTextContent('2 distinct lockers');
    expect(result).toHaveTextContent('3 rejected');
    expect(result).not.toHaveTextContent('failed');

    // Every store addressed the customer account, not an invented reference.
    const stores = fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/api/packages') && init?.method === 'POST',
    );
    expect(stores).toHaveLength(5);
    for (const [, init] of stores) {
      expect(JSON.parse(String(init?.body))).toEqual({ size: 'SMALL', customerId: 'u-alice' });
    }
  });

  it('explains itself when there is no customer to store for', async () => {
    mockApi({ '/api/users/customers': () => envelope(200, { items: [], total: 0 }) });
    render(<OperatorPanel onChanged={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /fire burst/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Add a customer account first/),
    );
    expect(screen.queryByTestId('burst-result')).not.toBeInTheDocument();
  });
});
