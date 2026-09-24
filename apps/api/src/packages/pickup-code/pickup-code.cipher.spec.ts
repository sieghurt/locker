import { PickupCodeCipher } from './pickup-code.cipher';

describe('PickupCodeCipher', () => {
  const cipher = new PickupCodeCipher('unit-test-encryption-key-unit-test-0000');

  it('round-trips a code with a fresh IV every time', () => {
    const a = cipher.encrypt('482913');
    const b = cipher.encrypt('482913');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('482913');
    expect(cipher.decrypt(b)).toBe('482913');
    expect(a).not.toContain('482913');
  });

  it('refuses tampered values and values from another key', () => {
    const value = cipher.encrypt('482913');
    const tampered = value.slice(0, -2) + (value.endsWith('AA') ? 'BB' : 'AA');
    expect(cipher.decrypt(tampered)).toBeNull();
    expect(
      new PickupCodeCipher('another-encryption-key-another-key-0000').decrypt(value),
    ).toBeNull();
    expect(cipher.decrypt('garbage')).toBeNull();
  });

  it('requires a strong key', () => {
    expect(() => new PickupCodeCipher('short')).toThrow(RangeError);
  });
});
