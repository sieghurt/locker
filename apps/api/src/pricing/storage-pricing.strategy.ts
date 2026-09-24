export interface StorageChargeTierLine {
  /** 1-based tier number in the order tiers were configured. */
  tier: number;
  days: number;
  ratePerDay: number;
  amount: number;
}

export interface StorageCharge {
  currency: string;
  storedAt: Date;
  retrievedAt: Date;
  /** Started 24-hour periods, before any free allowance is subtracted. */
  totalDays: number;
  freeDays: number;
  chargedDays: number;
  amount: number;
  breakdown: StorageChargeTierLine[];
}

/**
 * Anything that can turn a storage interval into a charge. Swap the bound implementation
 * (see PricingModule) to change the commercial rule without touching retrieval logic.
 */
export abstract class StoragePricingStrategy {
  abstract quote(storedAt: Date, retrievedAt: Date): StorageCharge;
}
