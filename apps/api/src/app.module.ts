import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { ClockModule } from './common/clock.module';
import { HealthController } from './common/health/health.controller';
import {
  RATE_LIMIT_BUCKET,
  RateLimitBucketName,
} from './common/rate-limit/rate-limit-bucket.decorator';
import { EnvironmentVariables, validateEnvironment } from './config/environment';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { DatabaseModule } from './database/database.module';
import { MailModule } from './mail/mail.module';
import { UsersModule } from './users/users.module';
import { LockersModule } from './lockers/lockers.module';
import { PackagesModule } from './packages/packages.module';
import { PricingModule } from './pricing/pricing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      envFilePath: ['.env'],
    }),
    // Two per-IP limiters: a generous one for the whole API and a strict one that applies only to
    // handlers marked @PickupRateLimited() (code guessing). Both limits come from the environment.
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, Reflector],
      useFactory: (config: ConfigService<EnvironmentVariables, true>, reflector: Reflector) => {
        const bucketOf = (context: ExecutionContext): RateLimitBucketName | undefined =>
          reflector.get<RateLimitBucketName | undefined>(RATE_LIMIT_BUCKET, context.getHandler());
        return {
          throttlers: [
            {
              name: 'default',
              ttl: 60_000,
              limit: config.get('RATE_LIMIT_PER_MINUTE', { infer: true }),
            },
            {
              name: 'pickup',
              ttl: 60_000,
              limit: config.get('PICKUP_RATE_LIMIT_PER_MINUTE', { infer: true }),
              skipIf: (context: ExecutionContext) => bucketOf(context) !== 'pickup',
            },
            {
              name: 'otp',
              ttl: 60_000,
              limit: config.get('OTP_RATE_LIMIT_PER_MINUTE', { infer: true }),
              skipIf: (context: ExecutionContext) => bucketOf(context) !== 'otp',
            },
          ],
        };
      },
    }),
    DatabaseModule,
    ClockModule,
    MailModule,
    UsersModule,
    AuthModule,
    BillingModule,
    PricingModule,
    LockersModule,
    PackagesModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
