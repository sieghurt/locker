/**
 * Runs before any test file is imported. ConfigModule.forRoot() reads and validates the environment
 * the moment AppModule is imported, so defaults must already be in place here, not in beforeAll.
 * They target the `db` service from docker-compose on its host port; DB_* overrides win.
 */
process.env.NODE_ENV = 'test';
process.env.DB_HOST ??= 'localhost';
process.env.DB_PORT ??= '5433';
process.env.DB_USER ??= 'locker';
process.env.DB_PASSWORD ??= 'locker';
process.env.DB_NAME ??= 'locker_test';
process.env.DB_SSL ??= 'false';
process.env.DB_MIGRATIONS_RUN = 'true';
process.env.PICKUP_CODE_SECRET ??= 'e2e-only-secret-not-for-production-use-0000';
process.env.PICKUP_MAX_FAILED_ATTEMPTS = '3';
process.env.PICKUP_CODE_ENCRYPTION_KEY ??= 'e2e-only-encryption-key-not-for-production-00';
process.env.AUTH_SECRET ??= 'e2e-only-auth-secret-not-for-production-0000';
process.env.OTP_MAX_ATTEMPTS = '3';
process.env.OTP_MAX_REQUESTS_PER_10_MIN = '5';
process.env.OTP_RATE_LIMIT_PER_MINUTE = '100000';
delete process.env.MAIL_HOST;
delete process.env.SEED_ADMIN_EMAIL;
delete process.env.SEED_USERS;
process.env.PICKUP_LOCKOUT_MINUTES = '15';
process.env.PICKUP_CODE_LENGTH = '6';
process.env.STORAGE_RATE_PER_DAY = '10';
process.env.STORAGE_TIER_1_DAYS = '5';
process.env.STORAGE_TIER_2_DAYS = '5';
process.env.STORAGE_FREE_DAYS = '0';
process.env.STORAGE_CURRENCY = 'UNITS';
// Suites fire many requests from one IP; limits are covered by unit-level config, not e2e.
process.env.RATE_LIMIT_PER_MINUTE = '100000';
process.env.PICKUP_RATE_LIMIT_PER_MINUTE = '100000';
delete process.env.SEED_LOCKERS;
