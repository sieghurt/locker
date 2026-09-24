import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../auth/AuthContext';
import { customer, envelope, failure, mockApi } from '../test/mock-api';
import { LoginPage } from './LoginPage';

const renderLogin = (entry: { pathname: string; state?: unknown } | string = '/login') =>
  render(
    <MemoryRouter initialEntries={[entry as never]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/pickup" element={<h1>Pickup home</h1>} />
          <Route path="/admin" element={<h1>Admin home</h1>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

describe('LoginPage', () => {
  afterEach(() => vi.restoreAllMocks());

  it('in demo mode, lists the accounts and logs in with one click using the returned code', async () => {
    const fetchMock = mockApi({
      '/api/auth/me': () => failure(401, 'NOT_LOGGED_IN'),
      '/api/auth/demo': () =>
        envelope(200, {
          enabled: true,
          accounts: [{ email: 'alice@test.local', role: 'CUSTOMER', displayName: 'Alice' }],
        }),
      'POST /api/auth/otp/request': () => envelope(202, { message: 'ok', demoCode: '135791' }),
      'POST /api/auth/otp/verify': () => envelope(200, customer),
    });
    renderLogin();

    fireEvent.click(await screen.findByRole('button', { name: /Alice/ }));
    await waitFor(() => expect(screen.getByText('Pickup home')).toBeInTheDocument());
    const verifyCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/auth/otp/verify'),
    );
    expect(JSON.parse(String(verifyCall?.[1]?.body))).toEqual({
      email: 'alice@test.local',
      code: '135791',
    });
  });

  it('shows no demo panel when the server is not in demo mode', async () => {
    mockApi({
      '/api/auth/me': () => failure(401, 'NOT_LOGGED_IN'),
      '/api/auth/demo': () => envelope(200, { enabled: false, accounts: [] }),
    });
    renderLogin();
    await screen.findByPlaceholderText('you@example.com');
    expect(screen.queryByTestId('demo-panel')).not.toBeInTheDocument();
  });

  it('requests a code, verifies it, and lands the customer on their screen', async () => {
    const fetchMock = mockApi({
      '/api/auth/me': () => failure(401, 'NOT_LOGGED_IN'),
      'POST /api/auth/otp/request': () => envelope(202, { message: 'ok' }),
      'POST /api/auth/otp/verify': () => envelope(200, customer),
    });
    renderLogin();

    fireEvent.change(await screen.findByPlaceholderText('you@example.com'), {
      target: { value: 'Alice@Test.local' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));

    await waitFor(() => expect(screen.getByPlaceholderText('6 digits')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('6 digits'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));

    await waitFor(() => expect(screen.getByText('Pickup home')).toBeInTheDocument());
    const verifyCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/auth/otp/verify'),
    );
    expect(JSON.parse(String(verifyCall?.[1]?.body))).toEqual({
      email: 'Alice@Test.local',
      code: '482913',
    });
  });

  it('shows the login-code error and keeps the form usable', async () => {
    mockApi({
      '/api/auth/me': () => failure(401, 'NOT_LOGGED_IN'),
      'POST /api/auth/otp/request': () => envelope(202, { message: 'ok' }),
      'POST /api/auth/otp/verify': () => failure(401, 'INVALID_LOGIN_CODE'),
    });
    renderLogin();
    fireEvent.change(await screen.findByPlaceholderText('you@example.com'), {
      target: { value: 'alice@test.local' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    fireEvent.change(await screen.findByPlaceholderText('6 digits'), {
      target: { value: '000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not valid/));
    expect(screen.getByRole('button', { name: /^log in$/i })).toBeEnabled();
  });

  it('ignores a remembered screen the new role may not use', async () => {
    mockApi({
      '/api/auth/me': () => failure(401, 'NOT_LOGGED_IN'),
      '/api/auth/demo': () => envelope(200, { enabled: false, accounts: [] }),
      'POST /api/auth/otp/request': () => envelope(202, { message: 'ok' }),
      'POST /api/auth/otp/verify': () => envelope(200, { ...customer, role: 'ADMIN' }),
    });
    // The previous user was signed out of /admin, which a customer could not use either way.
    renderLogin({ pathname: '/login', state: { from: '/admin' } });

    fireEvent.change(await screen.findByPlaceholderText('you@example.com'), {
      target: { value: 'admin@test.local' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send code/i }));
    fireEvent.change(await screen.findByPlaceholderText('6 digits'), {
      target: { value: '482913' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^log in$/i }));

    // An admin may use /admin, so they land there.
    await waitFor(() => expect(screen.getByText('Admin home')).toBeInTheDocument());
  });
});
