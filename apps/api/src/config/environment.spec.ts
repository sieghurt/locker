import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  const minimal = {
    PICKUP_CODE_SECRET: 'unit-test-secret-unit-test-secret-0000',
    AUTH_SECRET: 'unit-test-auth-secret-unit-test-auth-0000',
    PICKUP_CODE_ENCRYPTION_KEY: 'unit-test-encryption-key-unit-test-0000',
  };

  it('applies defaults and coerces numbers', () => {
    const env = validateEnvironment({ ...minimal, PORT: '4000', DB_PORT: '5433' });
    expect(env.PORT).toBe(4000);
    expect(env.DB_PORT).toBe(5433);
    expect(env.STORAGE_RATE_PER_DAY).toBe(10);
    expect(env.DB_MIGRATIONS_RUN).toBe(true);
  });

  it('treats the string "false" as false', () => {
    expect(
      validateEnvironment({ ...minimal, DB_SSL: 'false', DB_MIGRATIONS_RUN: 'false' }),
    ).toMatchObject({
      DB_SSL: false,
      DB_MIGRATIONS_RUN: false,
    });
  });

  it('refuses to start without a pickup code secret', () => {
    expect(() => validateEnvironment({})).toThrow(/PICKUP_CODE_SECRET/);
    expect(() => validateEnvironment({ PICKUP_CODE_SECRET: minimal.PICKUP_CODE_SECRET })).toThrow(
      /AUTH_SECRET/,
    );
  });

  it('refuses demo mode in production', () => {
    expect(validateEnvironment({ ...minimal, DEMO_MODE: 'true' }).DEMO_MODE).toBe(true);
    expect(() =>
      validateEnvironment({ ...minimal, DEMO_MODE: 'true', NODE_ENV: 'production' }),
    ).toThrow(/DEMO_MODE/);
  });

  it('refuses out-of-range values', () => {
    expect(() => validateEnvironment({ ...minimal, PICKUP_CODE_LENGTH: '20' })).toThrow(
      /PICKUP_CODE_LENGTH/,
    );
    expect(() => validateEnvironment({ ...minimal, STORAGE_RATE_PER_DAY: '-1' })).toThrow(
      /STORAGE_RATE_PER_DAY/,
    );
  });
});
