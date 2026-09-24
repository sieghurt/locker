import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { envelope, failure, mockApi } from '../test/mock-api';
import { ChargesPanel } from './ChargesPanel';

describe('ChargesPanel (admin)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows what is owed on waiting packages and what has been charged', async () => {
    mockApi({
      '/api/packages/charges': () =>
        envelope(200, {
          currency: 'UNITS',
          outstanding: { packages: 2, amount: 100 },
          collected: { packages: 4, amount: 123.46 },
        }),
    });
    render(<ChargesPanel version={0} />);

    await waitFor(() =>
      expect(screen.getByTestId('outstanding-amount')).toHaveTextContent('100.00 UNITS'),
    );
    expect(screen.getByText(/2 in lockers/)).toBeInTheDocument();
    expect(screen.getByTestId('collected-amount')).toHaveTextContent('123.46 UNITS');
    expect(screen.getByText(/4 collected/)).toBeInTheDocument();
  });

  it('reports a failure instead of showing nothing', async () => {
    mockApi({ '/api/packages/charges': () => failure(403, 'FORBIDDEN') });
    render(<ChargesPanel version={0} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not allowed/));
  });
});
