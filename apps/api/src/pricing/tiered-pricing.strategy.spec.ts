import { MS_PER_DAY, TieredPricingStrategy } from './tiered-pricing.strategy';

const X = 10;
const strategy = () =>
  new TieredPricingStrategy({
    ratePerDay: X,
    tiers: [
      { days: 5, multiplier: 1 },
      { days: 5, multiplier: 2 },
      { days: null, multiplier: 3 },
    ],
    freeDays: 0,
    currency: 'UNITS',
  });

const storedAt = new Date('2026-01-01T10:00:00.000Z');
const after = (ms: number) => new Date(storedAt.getTime() + ms);

describe('TieredPricingStrategy', () => {
  describe('chargeableDays', () => {
    it.each([
      [0, 0],
      [1, 1],
      [MS_PER_DAY - 1, 1],
      [MS_PER_DAY, 1],
      [MS_PER_DAY + 1, 2],
      [7 * MS_PER_DAY, 7],
      [7 * MS_PER_DAY + 60_000, 8],
    ])('%d ms elapsed -> %d day(s): a started 24h period counts as a day', (ms, expected) => {
      expect(TieredPricingStrategy.chargeableDays(storedAt, after(ms))).toBe(expected);
    });

    it('treats a retrieval clock slightly behind the storage clock as zero days (clock skew)', () => {
      expect(TieredPricingStrategy.chargeableDays(storedAt, after(-1))).toBe(0);
      expect(TieredPricingStrategy.chargeableDays(storedAt, after(-MS_PER_DAY))).toBe(0);
      expect(strategy().quote(storedAt, after(-5_000)).amount).toBe(0);
    });

    it('rejects invalid dates', () => {
      expect(() => TieredPricingStrategy.chargeableDays(storedAt, new Date('nope'))).toThrow(
        RangeError,
      );
    });
  });

  describe('quote', () => {
    it('charges nothing when stored and retrieved at the same instant', () => {
      const charge = strategy().quote(storedAt, storedAt);
      expect(charge.amount).toBe(0);
      expect(charge.chargedDays).toBe(0);
      expect(charge.breakdown).toEqual([]);
    });

    it('charges X per day within the first tier', () => {
      const charge = strategy().quote(storedAt, after(3 * MS_PER_DAY));
      expect(charge.amount).toBe(3 * X);
      expect(charge.breakdown).toEqual([{ tier: 1, days: 3, ratePerDay: X, amount: 3 * X }]);
    });

    it('fills the first tier exactly at the boundary', () => {
      const charge = strategy().quote(storedAt, after(5 * MS_PER_DAY));
      expect(charge.amount).toBe(5 * X);
      expect(charge.breakdown).toHaveLength(1);
    });

    it('moves into the 2X tier from day 6', () => {
      const charge = strategy().quote(storedAt, after(7 * MS_PER_DAY));
      expect(charge.breakdown).toEqual([
        { tier: 1, days: 5, ratePerDay: X, amount: 5 * X },
        { tier: 2, days: 2, ratePerDay: 2 * X, amount: 4 * X },
      ]);
      expect(charge.amount).toBe(9 * X);
    });

    it('charges 3X for every day beyond the tenth, with no upper bound', () => {
      const charge = strategy().quote(storedAt, after(12 * MS_PER_DAY));
      expect(charge.breakdown).toEqual([
        { tier: 1, days: 5, ratePerDay: X, amount: 5 * X },
        { tier: 2, days: 5, ratePerDay: 2 * X, amount: 10 * X },
        { tier: 3, days: 2, ratePerDay: 3 * X, amount: 6 * X },
      ]);
      expect(charge.amount).toBe(21 * X);
      expect(charge.totalDays).toBe(12);
      expect(charge.chargedDays).toBe(12);
    });

    it('subtracts a free allowance before tiering', () => {
      const withFreeDays = new TieredPricingStrategy({
        ratePerDay: X,
        tiers: [
          { days: 5, multiplier: 1 },
          { days: null, multiplier: 2 },
        ],
        freeDays: 2,
        currency: 'UNITS',
      });
      const charge = withFreeDays.quote(storedAt, after(6 * MS_PER_DAY));
      expect(charge.totalDays).toBe(6);
      expect(charge.freeDays).toBe(2);
      expect(charge.chargedDays).toBe(4);
      expect(charge.amount).toBe(4 * X);

      const shortStay = withFreeDays.quote(storedAt, after(MS_PER_DAY));
      expect(shortStay.amount).toBe(0);
      expect(shortStay.freeDays).toBe(1);
    });

    it('rounds money to two decimals', () => {
      const fractional = new TieredPricingStrategy({
        ratePerDay: 0.1,
        tiers: [{ days: null, multiplier: 1 }],
        freeDays: 0,
        currency: 'UNITS',
      });
      expect(fractional.quote(storedAt, after(3 * MS_PER_DAY)).amount).toBe(0.3);
    });

    it('echoes currency and timestamps', () => {
      const retrievedAt = after(MS_PER_DAY);
      const charge = strategy().quote(storedAt, retrievedAt);
      expect(charge).toMatchObject({ currency: 'UNITS', storedAt, retrievedAt });
    });
  });

  describe('configuration validation', () => {
    const base = { ratePerDay: X, freeDays: 0, currency: 'UNITS' };

    it('rejects an open-ended tier that is not last', () => {
      expect(
        () =>
          new TieredPricingStrategy({
            ...base,
            tiers: [
              { days: null, multiplier: 1 },
              { days: 5, multiplier: 2 },
            ],
          }),
      ).toThrow(RangeError);
    });

    it('rejects non-positive tier lengths, negative rates, and no tiers', () => {
      expect(
        () => new TieredPricingStrategy({ ...base, tiers: [{ days: 0, multiplier: 1 }] }),
      ).toThrow();
      expect(
        () =>
          new TieredPricingStrategy({
            ...base,
            ratePerDay: -1,
            tiers: [{ days: null, multiplier: 1 }],
          }),
      ).toThrow();
      expect(() => new TieredPricingStrategy({ ...base, tiers: [] })).toThrow();
    });
  });
});
