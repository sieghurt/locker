import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { admin, agent, customer, envelope, failure, lockerList, mockApi } from './test/mock-api';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );

describe('App routes and access', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends a visitor to the login page when a protected screen is opened', async () => {
    mockApi({ '/api/auth/me': () => failure(401, 'NOT_LOGGED_IN') });
    renderAt('/agent');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument(),
    );
  });

  it.each([
    [agent, '/agent', 'Delivery agent'],
    [customer, '/pickup', 'Customer pickup'],
    [admin, '/admin', 'Live activity'],
  ])('shows $0.role their screen with a live badge and user chip', async (user, path, heading) => {
    vi.stubGlobal(
      'EventSource',
      class {
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    mockApi({
      '/api/auth/me': () => envelope(200, user),
      '/api/lockers': () => envelope(200, lockerList([])),
      '/api/packages/mine': () => envelope(200, []),
      '/api/users': () => envelope(200, { items: [user], total: 1 }),
    });
    renderAt(path);
    await waitFor(() => expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument());
    expect(screen.getByTestId('live-badge')).toBeInTheDocument();
    expect(screen.getByTestId('user-chip')).toHaveTextContent(user.displayName!);
  });

  it('hides the customer-only panels from an admin on the pickup screen', async () => {
    vi.stubGlobal(
      'EventSource',
      class {
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    mockApi({
      '/api/auth/me': () => envelope(200, admin),
      '/api/lockers': () => envelope(200, lockerList([])),
    });
    renderAt('/pickup');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Customer pickup' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('heading', { name: 'My packages' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'My account' })).not.toBeInTheDocument();
  });

  it('redirects a customer who opens the admin screen to their own home', async () => {
    vi.stubGlobal(
      'EventSource',
      class {
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    mockApi({
      '/api/auth/me': () => envelope(200, customer),
      '/api/lockers': () => envelope(200, lockerList([])),
      '/api/packages/mine': () => envelope(200, []),
    });
    renderAt('/admin');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Customer pickup' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: 'Station admin' })).not.toBeInTheDocument();
  });

  it('drops to the login screen when a request comes back unauthorized mid-session', async () => {
    vi.stubGlobal(
      'EventSource',
      class {
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    let sessionValid = true;
    mockApi({
      '/api/auth/me': () => (sessionValid ? envelope(200, agent) : failure(401, 'NOT_LOGGED_IN')),
      '/api/lockers': () =>
        sessionValid ? envelope(200, lockerList([])) : failure(401, 'NOT_LOGGED_IN'),
      '/api/users/customers': () => failure(401, 'NOT_LOGGED_IN'),
    });
    renderAt('/agent');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Delivery agent' })).toBeInTheDocument(),
    );

    // The session expires; the next request the screen makes returns 401.
    sessionValid = false;
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'ali' } });

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument(),
    );
  });

  it('redirects unknown paths home, and home shows the login link to visitors', async () => {
    mockApi({ '/api/auth/me': () => failure(401, 'NOT_LOGGED_IN') });
    renderAt('/nope');
    await waitFor(() =>
      expect(screen.getAllByRole('link', { name: 'Log in' }).length).toBeGreaterThan(0),
    );
  });
});
