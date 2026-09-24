import { createHmac, timingSafeEqual } from 'node:crypto';

import { UserRole } from '../users/user-role';

export interface SessionUser {
  id: string;
  role: UserRole;
  email: string;
}

interface Payload extends SessionUser {
  iat: number;
  exp: number;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');
const fromB64url = (input: string): Buffer => Buffer.from(input, 'base64url');

/**
 * Stateless session tokens: `<base64url payload>.<base64url HMAC-SHA256>`, kept in an httpOnly cookie.
 * Same idea as a JWT without the header ceremony or a library; a leaked signing secret is the only way
 * to forge one, and rotating AUTH_SECRET logs everyone out.
 */
export class SessionTokenService {
  constructor(
    private readonly secret: string,
    private readonly ttlMs: number,
  ) {
    if (secret.length < 32) throw new RangeError('auth secret must be at least 32 characters');
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('session ttl must be positive');
  }

  issue(user: SessionUser, now = new Date()): { token: string; expiresAt: Date } {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = Math.floor((now.getTime() + this.ttlMs) / 1000);
    const payload: Payload = { id: user.id, role: user.role, email: user.email, iat, exp };
    const body = b64url(JSON.stringify(payload));
    return { token: `${body}.${this.sign(body)}`, expiresAt: new Date(exp * 1000) };
  }

  /** Returns the user for a valid, unexpired token; null for anything else (never throws on bad input). */
  verify(token: string | undefined, now = new Date()): SessionUser | null {
    if (!token) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    const expected = this.sign(body);
    const a = fromB64url(signature);
    const b = fromB64url(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

    let payload: Payload;
    try {
      payload = JSON.parse(fromB64url(body).toString('utf8')) as Payload;
    } catch {
      return null;
    }
    if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now.getTime()) return null;
    if (!payload.id || !payload.role || !payload.email) return null;
    return { id: payload.id, role: payload.role, email: payload.email };
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }
}
