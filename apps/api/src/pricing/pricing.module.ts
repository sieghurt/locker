import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../config/environment';
import { StoragePricingStrategy } from './storage-pricing.strategy';
import { TieredPricingStrategy } from './tiered-pricing.strategy';

/**
 * Binds the abstract StoragePricingStrategy to the configured tiered rule:
 *   tier 1: 1x rate for STORAGE_TIER_1_DAYS, tier 2: 2x for STORAGE_TIER_2_DAYS, tier 3: 3x thereafter.
 * To introduce another rule, provide a different implementation here; nothing else changes.
 */
@Module({
  providers: [
    {
      provide: StoragePricingStrategy,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new TieredPricingStrategy({
          ratePerDay: config.get('STORAGE_RATE_PER_DAY', { infer: true }),
          tiers: [
            { days: config.get('STORAGE_TIER_1_DAYS', { infer: true }), multiplier: 1 },
            { days: config.get('STORAGE_TIER_2_DAYS', { infer: true }), multiplier: 2 },
            { days: null, multiplier: 3 },
          ],
          freeDays: config.get('STORAGE_FREE_DAYS', { infer: true }),
          currency: config.get('STORAGE_CURRENCY', { infer: true }),
        }),
    },
  ],
  exports: [StoragePricingStrategy],
})
export class PricingModule {}
