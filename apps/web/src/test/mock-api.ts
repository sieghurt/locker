import { vi } from 'vitest';

import type { Locker, User } from '../api/types';

export const envelope = (status: number, data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const failure = (status: number, code: string, message = code) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export const admin: User = {
  id: 'u-admin',
  email: 'admin@test.local',
  role: 'ADMIN',
  displayName: 'Admin',
  active: true,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
export const agent: User = {
  ...admin,
  id: 'u-agent',
  email: 'agent@test.local',
  role: 'AGENT',
  displayName: 'Agent',
};
export const customer: User = {
  ...admin,
  id: 'u-alice',
  email: 'alice@test.local',
  role: 'CUSTOMER',
  displayName: 'Alice',
};

export const lockerList = (items: Locker[]) => ({
  items,
  total: items.length,
  limit: 500,
  offset: 0,
});

/** Routes fetch by URL so page tests can describe the backend in one place. */
export function mockApi(
  routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>,
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input).split('?')[0];
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`;
    const handler = routes[key] ?? routes[url];
    if (!handler) return Promise.resolve(failure(404, 'NOT_FOUND', `no mock for ${key}`));
    return Promise.resolve(handler(init));
  });
}
