import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pickup codes are short (a keypad entry), so a plain hash would be trivially reversible if the
 * database leaked. Keying the hash with a server-side secret means a leaked table is useless
 * without the secret, and comparison is constant-time.
 */
export class PickupCodeHasher {
  constructor(private readonly secret: string) {
    if (secret.length < 32) {
      throw new RangeError('pickup code secret must be at least 32 characters');
    }
  }

  hash(code: string): string {
    return createHmac('sha256', this.secret).update(code, 'utf8').digest('hex');
  }

  verify(code: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hash(code), 'hex');
    const expected = Buffer.from(expectedHash.trim(), 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
