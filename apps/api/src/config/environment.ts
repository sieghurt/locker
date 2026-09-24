import 'reflect-metadata';
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnvironment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * class-transformer's implicit conversion turns the string "false" into `true` before @Transform
 * runs, so read the raw value from the source object instead of the converted one.
 */
const toBoolean = ({ obj, key }: { obj: Record<string, unknown>; key: string }): unknown => {
  const value = obj[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no', ''].includes(normalized)) return false;
  }
  return value;
};

/**
 * Every environment variable the service reads, with its type, default, and constraints.
 * Validated once at boot: a misconfigured service refuses to start instead of failing on first use.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnvironment)
  NODE_ENV: NodeEnvironment = NodeEnvironment.Development;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  DB_HOST: string = 'localhost';

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  DB_USER: string = 'locker';

  @IsString()
  DB_PASSWORD: string = 'locker';

  @IsString()
  DB_NAME: string = 'locker';

  @Transform(toBoolean)
  @IsBoolean()
  DB_SSL: boolean = false;

  @Transform(toBoolean)
  @IsBoolean()
  DB_MIGRATIONS_RUN: boolean = true;

  /** Keys the HMAC of stored codes. Long enough that a leaked table plus one known code cannot recover it offline. */
  @IsString()
  @MinLength(32)
  PICKUP_CODE_SECRET!: string;

  @IsInt()
  @Min(4)
  @Max(12)
  PICKUP_CODE_LENGTH: number = 6;

  /** Encrypts waiting pickup codes so an admin can read them out. Separate from PICKUP_CODE_SECRET on purpose. */
  @IsString()
  @MinLength(32)
  PICKUP_CODE_ENCRYPTION_KEY!: string;

  @IsNumber()
  @Min(0)
  STORAGE_RATE_PER_DAY: number = 10;

  @IsInt()
  @Min(1)
  STORAGE_TIER_1_DAYS: number = 5;

  @IsInt()
  @Min(1)
  STORAGE_TIER_2_DAYS: number = 5;

  @IsInt()
  @Min(0)
  STORAGE_FREE_DAYS: number = 0;

  @IsString()
  STORAGE_CURRENCY: string = 'UNITS';

  /** Requests per minute per client IP across the whole API. */
  @IsInt()
  @Min(1)
  RATE_LIMIT_PER_MINUTE: number = 300;

  /** Pickup attempts per minute per client IP (POST /packages/retrieve). First line against guessing. */
  @IsInt()
  @Min(1)
  PICKUP_RATE_LIMIT_PER_MINUTE: number = 10;

  /** Wrong codes tolerated per package before its locker is locked out. The control that really protects a 6-digit space. */
  @IsInt()
  @Min(1)
  PICKUP_MAX_FAILED_ATTEMPTS: number = 5;

  /** How long a locked-out package refuses pickups. */
  @IsInt()
  @Min(1)
  PICKUP_LOCKOUT_MINUTES: number = 15;

  /** Set when running behind a reverse proxy so per-IP limits see the client, not the proxy. */
  @Transform(toBoolean)
  @IsBoolean()
  TRUST_PROXY: boolean = false;

  /** Signs session cookies and keys the hash of login codes. Rotating it logs everyone out. */
  @IsString()
  @MinLength(32)
  AUTH_SECRET!: string;

  @IsInt()
  @Min(1)
  @Max(24 * 30)
  SESSION_TTL_HOURS: number = 12;

  @IsInt()
  @Min(4)
  @Max(10)
  OTP_LENGTH: number = 6;

  @IsInt()
  @Min(1)
  @Max(60)
  OTP_TTL_MINUTES: number = 10;

  @IsInt()
  @Min(1)
  OTP_MAX_ATTEMPTS: number = 5;

  /** Login codes one account may request per 10 minutes; further requests are dropped silently. */
  @IsInt()
  @Min(1)
  OTP_MAX_REQUESTS_PER_10_MIN: number = 3;

  /** Per-IP ceiling on the login-code endpoints. */
  @IsInt()
  @Min(1)
  OTP_RATE_LIMIT_PER_MINUTE: number = 10;

  /** SMTP host. Empty = emails are not sent, only logged (fine for tests, useless for logging in). */
  @IsOptional()
  @IsString()
  MAIL_HOST?: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  MAIL_PORT: number = 1025;

  @Transform(toBoolean)
  @IsBoolean()
  MAIL_SECURE: boolean = false;

  @IsOptional()
  @IsString()
  MAIL_USER?: string;

  @IsOptional()
  @IsString()
  MAIL_PASSWORD?: string;

  @IsString()
  MAIL_FROM: string = 'Smart Package Locker <no-reply@locker.local>';

  /** Creates the first admin when the users table is empty. Without it nobody can log in. */
  @IsOptional()
  @IsString()
  SEED_ADMIN_EMAIL?: string;

  /** Optional demo accounts, e.g. "agent@locker.local:AGENT,alice@locker.local:CUSTOMER". Applied only to an empty table. */
  @IsOptional()
  @IsString()
  SEED_USERS?: string;

  /**
   * Demo mode: the login endpoint returns the one-time code in its response and GET /auth/demo lists
   * the accounts, so a reviewer can log in with one click without an inbox. Refused in production.
   */
  @Transform(toBoolean)
  @IsBoolean()
  DEMO_MODE: boolean = false;

  /** Optional boot-time seed, e.g. "SMALL:3,MEDIUM:2,LARGE:1". Applied only when the lockers table is empty. */
  @IsOptional()
  @IsString()
  SEED_LOCKERS?: string;
}

/**
 * Markers of the throwaway secrets shipped in docker-compose.yml and the e2e config. They keep the
 * one-command demo working; `isPlaceholderSecret` is what stops them reaching anything real.
 */
const PLACEHOLDER_MARKERS = ['change-me', 'local-dev', 'e2e-only', 'not-for-production'];

export function isPlaceholderSecret(value: string | undefined): boolean {
  return !!value && PLACEHOLDER_MARKERS.some((marker) => value.toLowerCase().includes(marker));
}

/** The secrets whose value must be real before anyone outside the machine can reach the service. */
export function placeholderSecretsIn(config: EnvironmentVariables): string[] {
  return (['AUTH_SECRET', 'PICKUP_CODE_SECRET', 'PICKUP_CODE_ENCRYPTION_KEY'] as const).filter(
    (name) => isPlaceholderSecret(config[name]),
  );
}

export function validateEnvironment(raw: Record<string, unknown>): EnvironmentVariables {
  const config = plainToInstance(EnvironmentVariables, raw, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });
  const errors = validateSync(config, { whitelist: false, forbidUnknownValues: false });
  if (config.DEMO_MODE && config.NODE_ENV === NodeEnvironment.Production) {
    throw new Error(
      'Invalid environment configuration:\n  DEMO_MODE cannot be enabled when NODE_ENV=production',
    );
  }
  const placeholders = placeholderSecretsIn(config);
  if (placeholders.length > 0 && config.NODE_ENV === NodeEnvironment.Production) {
    throw new Error(
      `Invalid environment configuration:\n  ${placeholders.join(', ')} still hold the development ` +
        'placeholder value; set real secrets before running in production',
    );
  }
  if (errors.length > 0) {
    const details = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${details}`);
  }
  return config;
}
