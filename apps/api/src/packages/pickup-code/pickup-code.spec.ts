import { NumericPickupCodeGenerator } from './pickup-code.generator';
import { PickupCodeHasher } from './pickup-code.hasher';

describe('NumericPickupCodeGenerator', () => {
  it('produces zero-padded numeric codes of the configured length', () => {
    const generator = new NumericPickupCodeGenerator(6);
    for (let i = 0; i < 200; i++) {
      expect(generator.generate()).toMatch(/^\d{6}$/);
    }
  });

  it('does not produce the same code every time', () => {
    const generator = new NumericPickupCodeGenerator(8);
    const codes = new Set(Array.from({ length: 50 }, () => generator.generate()));
    expect(codes.size).toBeGreaterThan(1);
  });

  it('rejects lengths outside 4..12', () => {
    expect(() => new NumericPickupCodeGenerator(3)).toThrow(RangeError);
    expect(() => new NumericPickupCodeGenerator(13)).toThrow(RangeError);
  });
});

describe('PickupCodeHasher', () => {
  const hasher = new PickupCodeHasher('unit-test-secret-unit-test-secret-0000');

  it('verifies the code it hashed', () => {
    const hash = hasher.hash('482913');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hasher.verify('482913', hash)).toBe(true);
  });

  it('rejects a different code', () => {
    expect(hasher.verify('482914', hasher.hash('482913'))).toBe(false);
  });

  it('is keyed: the same code under another secret does not verify', () => {
    const other = new PickupCodeHasher('another-secret-another-secret-00000000');
    expect(other.verify('482913', hasher.hash('482913'))).toBe(false);
  });

  it('tolerates the trailing padding a char(64) column may return', () => {
    expect(hasher.verify('482913', `${hasher.hash('482913')}   `)).toBe(true);
  });

  it('refuses a weak secret', () => {
    expect(() => new PickupCodeHasher('only-sixteen-chr')).toThrow(RangeError);
  });
});
