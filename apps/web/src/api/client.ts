import type {
  Account,
  ChargesSummary,
  CustomerSummary,
  DemoInfo,
  Locker,
  LockerList,
  LockerSize,
  PackageSummary,
  RevealedPickupCode,
  RetrievedPackage,
  Statement,
  StoredPackage,
  Transaction,
  User,
  UserRole,
} from './types';

/** The API's uniform envelope. */
type Envelope<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string; details?: unknown } };

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | undefined;

/** AuthProvider registers here so any 401 from any call drops the app to the login screen. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | undefined): void {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Calls the backend through the same origin (`/api/...`): Vite proxies it in development, nginx in
 * Docker. Unwraps the `{ success, data }` envelope and turns `{ success: false }` into an ApiError.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch (cause) {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the locker service', cause);
  }

  if (response.status === 204) return undefined as T;

  let body: Envelope<T> | undefined;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    body = undefined;
  }

  if (!body || typeof body !== 'object' || !('success' in body)) {
    throw new ApiError(
      response.status,
      'BAD_RESPONSE',
      `Unexpected response (HTTP ${response.status})`,
    );
  }
  if (!body.success) {
    if (response.status === 401) onUnauthorized?.();
    throw new ApiError(response.status, body.error.code, body.error.message, body.error.details);
  }
  return body.data;
}

export const lockersApi = {
  list: () => api<LockerList>('/lockers?limit=500'),
  /** Admin only: the code of the package waiting in a locker. */
  revealPickupCode: (lockerId: string) =>
    api<RevealedPickupCode>(`/lockers/${lockerId}/pickup-code`),
  create: (label: string, size: LockerSize) =>
    api<Locker>('/lockers', { method: 'POST', body: JSON.stringify({ label, size }) }),
};

export const packagesApi = {
  store: (size: LockerSize, customerId: string) =>
    api<StoredPackage>('/packages', { method: 'POST', body: JSON.stringify({ size, customerId }) }),
  retrieve: (lockerId: string, pickupCode: string) =>
    api<RetrievedPackage>('/packages/retrieve', {
      method: 'POST',
      body: JSON.stringify({ lockerId, pickupCode }),
    }),
  mine: () => api<PackageSummary[]>('/packages/mine'),
  /** Admin only: what the station is owed and what it has charged. */
  charges: () => api<ChargesSummary>('/packages/charges'),
};

export const accountsApi = {
  me: () => api<Account>('/accounts/me'),
  myTransactions: (limit = 20) => api<Statement>(`/accounts/me/transactions?limit=${limit}`),
  list: () => api<{ items: Account[]; total: number; totalBalance: number }>('/accounts?limit=200'),
  transactions: (customerId: string, limit = 50) =>
    api<Statement>(`/accounts/${customerId}/transactions?limit=${limit}`),
  recordPayment: (customerId: string, amount: number, note?: string) =>
    api<Transaction>(`/accounts/${customerId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount, note: note || undefined }),
    }),
};

export const authApi = {
  me: () => api<User>('/auth/me'),
  /** `demoCode` is present only when the server runs in DEMO_MODE. */
  requestCode: (email: string) =>
    api<{ message: string; demoCode?: string }>('/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  demo: () => api<DemoInfo>('/auth/demo'),
  verifyCode: (email: string, code: string) =>
    api<User>('/auth/otp/verify', { method: 'POST', body: JSON.stringify({ email, code }) }),
  logout: () => api<void>('/auth/logout', { method: 'POST' }),
};

export const usersApi = {
  /** Empty query lists the first customers; the API rejects an empty `q`, so it is omitted. */
  customers: (q: string) =>
    api<{ items: CustomerSummary[]; total: number }>(
      `/users/customers?limit=10${q ? `&q=${encodeURIComponent(q)}` : ''}`,
    ),
  list: () => api<{ items: User[]; total: number }>('/users?limit=200'),
  create: (email: string, role: UserRole, displayName?: string) =>
    api<User>('/users', {
      method: 'POST',
      body: JSON.stringify({ email, role, displayName: displayName || undefined }),
    }),
  update: (id: string, patch: Partial<Pick<User, 'role' | 'displayName' | 'active'>>) =>
    api<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

/** Human wording for the error codes the kiosk can show a customer or agent. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Please try again.';
  switch (error.code) {
    case 'NO_SUITABLE_LOCKER':
      return 'No available locker can hold this package right now. It cannot be stored.';
    case 'INVALID_PICKUP_CODE':
      return 'That pickup code does not match this locker.';
    case 'LOCKER_EMPTY':
      return 'This locker has no package waiting for pickup.';
    case 'LOCKER_NOT_FOUND':
      return 'That locker does not exist.';
    case 'PICKUP_LOCKED':
      return error.message;
    case 'TOO_MANY_REQUESTS':
      return 'Too many attempts. Please wait a minute and try again.';
    case 'VALIDATION_ERROR':
      return Array.isArray(error.details) ? error.details.join('. ') : error.message;
    case 'NETWORK_ERROR':
      return 'Cannot reach the locker service. Is the API running?';
    case 'NOT_LOGGED_IN':
      return 'Your session has ended. Please log in again.';
    case 'FORBIDDEN':
      return 'Your account is not allowed to do this.';
    case 'INVALID_LOGIN_CODE':
      return 'That code is not valid. Request a new one and try again.';
    case 'NOT_YOUR_PACKAGE':
      return 'The package in this locker is not addressed to your account.';
    case 'CUSTOMER_NOT_FOUND':
      return 'Choose an active customer account for this package.';
    case 'EMAIL_TAKEN':
      return 'A user with that email already exists.';
    default:
      return error.message;
  }
}
