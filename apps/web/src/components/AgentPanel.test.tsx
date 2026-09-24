import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, mockApi } from '../test/mock-api';
import { AgentPanel } from './AgentPanel';

describe('AgentPanel', () => {
  afterEach(() => vi.restoreAllMocks());

  const storedResponse = (withCode: boolean) => ({
    packageId: 'p1',
    lockerId: 'l1',
    lockerLabel: 'S-01',
    lockerSize: 'SMALL',
    packageSize: 'SMALL',
    ...(withCode ? { pickupCode: '482913' } : {}),
    storedAt: '2026-01-01T00:00:00.000Z',
    customer: { id: 'u-alice', label: 'Alice' },
    notified: true,
  });

  it('lets the agent pick a customer from the masked directory and store; the code is emailed, never shown', async () => {
    const fetchMock = mockApi({
      '/api/users/customers': () =>
        envelope(200, {
          items: [{ id: 'u-alice', label: 'Alice', maskedEmail: 'al***@test.local' }],
          total: 1,
        }),
      'POST /api/packages': () => envelope(201, storedResponse(false)),
    });
    const onStored = vi.fn();
    render(<AgentPanel onStored={onStored} />);

    expect(screen.getByRole('button', { name: /store package/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'ali' } });
    fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));
    expect(screen.getByTestId('picked-customer')).toHaveTextContent('Alice');

    fireEvent.click(screen.getByRole('button', { name: /store package/i }));
    await waitFor(() => expect(screen.getByText(/emailed to the customer/i)).toBeInTheDocument());
    expect(screen.queryByTestId('pickup-code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reveal code/i })).not.toBeInTheDocument();

    const storeCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith('/api/packages') && init?.method === 'POST',
    );
    expect(JSON.parse(String(storeCall?.[1]?.body))).toEqual({
      size: 'SMALL',
      customerId: 'u-alice',
    });
    expect(onStored).toHaveBeenCalled();
  });

  it('lets an admin reveal the code the API returned to them', async () => {
    mockApi({
      '/api/users/customers': () =>
        envelope(200, {
          items: [{ id: 'u-alice', label: 'Alice', maskedEmail: 'al***@test.local' }],
          total: 1,
        }),
      'POST /api/packages': () => envelope(201, storedResponse(true)),
    });
    render(<AgentPanel onStored={() => {}} canRevealCode />);

    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'ali' } });
    fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));
    fireEvent.click(screen.getByRole('button', { name: /store package/i }));

    const reveal = await screen.findByRole('button', { name: /reveal code/i });
    expect(screen.queryByTestId('pickup-code')).not.toBeInTheDocument();
    fireEvent.click(reveal);
    expect(screen.getByTestId('pickup-code')).toHaveTextContent('482913');
  });
});
