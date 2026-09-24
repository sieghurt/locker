import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Clock } from '../common/clock';
import { EnvironmentVariables } from '../config/environment';
import { Mailer } from '../mail/mailer';
import { UsersModule } from '../users/users.module';
import { UsersRepository } from '../users/users.repository';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpCode } from './otp-code.entity';
import { OtpPolicy } from './otp.policy';
import { OtpRepository } from './otp.repository';
import { SessionGuard } from './session.guard';
import { SessionTokenService } from './session-token.service';

@Module({
  imports: [TypeOrmModule.forFeature([OtpCode]), UsersModule],
  controllers: [AuthController],
  providers: [
    OtpRepository,
    {
      provide: SessionTokenService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new SessionTokenService(
          config.get('AUTH_SECRET', { infer: true }),
          config.get('SESSION_TTL_HOURS', { infer: true }) * 3_600_000,
        ),
    },
    {
      provide: OtpPolicy,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        new OtpPolicy(
          config.get('OTP_LENGTH', { infer: true }),
          config.get('OTP_TTL_MINUTES', { infer: true }) * 60_000,
          config.get('OTP_MAX_ATTEMPTS', { infer: true }),
          config.get('OTP_MAX_REQUESTS_PER_10_MIN', { infer: true }),
          10 * 60_000,
        ),
    },
    {
      provide: AuthService,
      inject: [
        UsersRepository,
        OtpRepository,
        Mailer,
        SessionTokenService,
        OtpPolicy,
        Clock,
        ConfigService,
      ],
      useFactory: (
        users: UsersRepository,
        otps: OtpRepository,
        mailer: Mailer,
        sessions: SessionTokenService,
        policy: OtpPolicy,
        clock: Clock,
        config: ConfigService<EnvironmentVariables, true>,
      ) =>
        new AuthService(
          users,
          otps,
          mailer,
          sessions,
          policy,
          clock,
          config.get('AUTH_SECRET', { infer: true }),
          config.get('DEMO_MODE', { infer: true }),
        ),
    },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [SessionTokenService],
})
export class AuthModule {}
