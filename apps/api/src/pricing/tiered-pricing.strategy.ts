import {
  StorageCharge,
  StorageChargeTierLine,
  StoragePricingStrategy,
} from './storage-pricing.strategy';

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PricingTier {
  /** Number of days this tier covers; `null` = open-ended last tier. */
  days: number | null;
  /** Multiplier applied to the base rate for days in this tier. */
  multiplier: number;
}

export interface TieredPricingOptions {
  ratePerDay: number;
  tiers: PricingTier[];
  /** Days at the start of the stay that are not charged at all. */
  freeDays: number;
  currency: string;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Tiered day-rate pricing, e.g. X/day for days 1-5, 2X/day for days 6-10, 3X/day thereafter.
 * A "day" is a started 24-hour period counted from the moment the package was stored
 * (0h < t <= 24h is one day, 24h < t <= 48h is two, and so on).
 */
export class TieredPricingStrategy extends StoragePricingStrategy {
  constructor(private readonly options: TieredPricingOptions) {
    super();
    TieredPricingStrategy.validate(options);
  }

  static chargeableDays(storedAt: Date, retrievedAt: Date): number {
    const elapsedMs = retrievedAt.getTime() - storedAt.getTime();
    if (!Number.isFinite(elapsedMs)) {
      throw new RangeError('storedAt and retrievedAt must be valid dates');
    }
    // A retrieval clock slightly behind the storage clock (NTP step, skewed replicas) is a
    // zero-day stay, not an error: never make a package unretrievable over clock drift.
    return Math.max(0, Math.ceil(elapsedMs / MS_PER_DAY));
  }

  quote(storedAt: Date, retrievedAt: Date): StorageCharge {
    const totalDays = TieredPricingStrategy.chargeableDays(storedAt, retrievedAt);
    const { ratePerDay, tiers, freeDays, currency } = this.options;

    let remaining = Math.max(0, totalDays - freeDays);
    const chargedDays = remaining;
    const breakdown: StorageChargeTierLine[] = [];
    let amount = 0;

    for (const [index, tier] of tiers.entries()) {
      if (remaining <= 0) break;
      const days = tier.days === null ? remaining : Math.min(tier.days, remaining);
      const tierRate = round2(ratePerDay * tier.multiplier);
      const tierAmount = round2(days * tierRate);
      breakdown.push({ tier: index + 1, days, ratePerDay: tierRate, amount: tierAmount });
      amount = round2(amount + tierAmount);
      remaining -= days;
    }

    return {
      currency,
      storedAt,
      retrievedAt,
      totalDays,
      freeDays: Math.min(freeDays, totalDays),
      chargedDays,
      amount,
      breakdown,
    };
  }

  private static validate(options: TieredPricingOptions): void {
    if (options.ratePerDay < 0) throw new RangeError('ratePerDay must be >= 0');
    if (options.freeDays < 0 || !Number.isInteger(options.freeDays)) {
      throw new RangeError('freeDays must be a non-negative integer');
    }
    if (options.tiers.length === 0) throw new RangeError('at least one pricing tier is required');
    options.tiers.forEach((tier, index) => {
      const isLast = index === options.tiers.length - 1;
      if (tier.multiplier < 0) throw new RangeError(`tier ${index + 1}: multiplier must be >= 0`);
      if (tier.days === null && !isLast) {
        throw new RangeError(`tier ${index + 1}: only the last tier may be open-ended`);
      }
      if (tier.days !== null && (!Number.isInteger(tier.days) || tier.days < 1)) {
        throw new RangeError(`tier ${index + 1}: days must be a positive integer or null`);
      }
    });
  }
}
