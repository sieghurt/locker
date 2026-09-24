import { afterEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, describeError } from './client';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  afterEach(() => vi.restoreAllMocks());

  it('unwraps the success envelope and calls the same-origin /api prefix', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, { success: true, data: { ok: 1 } }));

    await expect(api<{ ok: number }>('/lockers')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/lockers',
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it('turns an error envelope into an ApiError carrying status, code and details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(409, {
        success: false,
        error: { code: 'NO_SUITABLE_LOCKER', message: 'nope', details: { packageSize: 'LARGE' } },
      }),
    );

    const error = await api('/packages', { method: 'POST' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'NO_SUITABLE_LOCKER',
      details: { packageSize: 'LARGE' },
    });
  });

  it('reports a non-envelope body as BAD_RESPONSE', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(api('/lockers')).rejects.toMatchObject({ code: 'BAD_RESPONSE', status: 502 });
  });

  it('reports a failed fetch as NETWORK_ERROR', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(api('/lockers')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('describeError', () => {
  it('translates known codes into kiosk wording', () => {
    expect(describeError(new ApiError(409, 'NO_SUITABLE_LOCKER', 'x'))).toMatch(/cannot be stored/);
    expect(describeError(new ApiError(403, 'INVALID_PICKUP_CODE', 'x'))).toMatch(/does not match/);
    expect(describeError(new ApiError(429, 'TOO_MANY_REQUESTS', 'x'))).toMatch(/Too many attempts/);
  });

  it('joins validation details and passes lockout messages through', () => {
    expect(describeError(new ApiError(400, 'VALIDATION_ERROR', 'x', ['a', 'b']))).toBe('a. b');
    expect(describeError(new ApiError(423, 'PICKUP_LOCKED', 'locked until noon'))).toBe(
      'locked until noon',
    );
  });

  it('falls back for unknown errors', () => {
    expect(describeError(new Error('boom'))).toMatch(/Something went wrong/);
  });
});
