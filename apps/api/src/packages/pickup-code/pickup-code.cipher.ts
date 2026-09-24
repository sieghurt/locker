import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Reversible protection for pickup codes that are still waiting in a locker, so a station admin can
 * read one out to a customer. AES-256-GCM with a random IV per code; the key is derived from a secret
 * that is deliberately separate from the HMAC secret used for verification, so leaking one does not
 * compromise the other. Format: `v1.<iv>.<tag>.<ciphertext>` in base64url.
 */
export class PickupCodeCipher {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32)
      throw new RangeError('pickup code encryption key must be at least 32 characters');
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  encrypt(code: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  /** Returns the code, or null if the value is malformed, tampered with, or encrypted under another key. */
  decrypt(value: string): string | null {
    const [version, iv, tag, ciphertext] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ciphertext) return null;
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null;
    }
  }
}
