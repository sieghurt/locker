import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EnvironmentVariables } from '../config/environment';
import { BillingModule } from '../billing/billing.module';
import { LockersModule } from '../lockers/lockers.module';
import { PricingModule } from '../pricing/pricing.module';
import { UsersModule } from '../users/users.module';
import { Package } from './package.entity';
import { PackagesController } from './packages.controller';
import { PickupCodeController } from './pickup-code.controller';
import { PackagesRepository } from './packages.repository';
import { PackagesService } from './packages.service';
import {
  NumericPickupCodeGenerator,
  PickupCodeGenerator,
} from './pickup-code/pickup-code.generator';
import { PickupCodeCipher } from './pickup-code/pickup-code.cipher';
import { PickupCodeHasher } from './pickup-code/pickup-code.hasher';
import { PickupLockoutPolicy } from './pickup-code/pickup-lockout.policy';

@Module({
  imports: [
    TypeOrmModule.forFeature([Package]),
    LockersModule,
    PricingModule,
    UsersModule,
    BillingModule,
  ],
  controllers: [PackagesController, PickupCodeController],
  providers: [
    PackagesRepository,
    PackagesService,
    {
      provide: PickupCodeGenerator,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new NumericPickupCodeGenerator(config.get('PICKUP_CODE_LENGTH', { infer: true })),
    },
    {
      provide: PickupCodeHasher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new PickupCodeHasher(config.get('PICKUP_CODE_SECRET', { infer: true })),
    },
    {
      provide: PickupCodeCipher,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new PickupCodeCipher(config.get('PICKUP_CODE_ENCRYPTION_KEY', { infer: true })),
    },
    {
      provide: PickupLockoutPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new PickupLockoutPolicy(
          config.get('PICKUP_MAX_FAILED_ATTEMPTS', { infer: true }),
          config.get('PICKUP_LOCKOUT_MINUTES', { infer: true }) * 60_000,
        ),
    },
  ],
})
export class PackagesModule {}
