/**
 * Imported first by rate-limit.e2e-spec.ts. ES imports evaluate in order, and ConfigModule reads
 * the environment when AppModule is first imported, so this runs before the app is loaded and only
 * affects that one test file (each Jest file has its own module registry).
 */
process.env.PICKUP_RATE_LIMIT_PER_MINUTE = '3';
process.env.RATE_LIMIT_PER_MINUTE = '1000';
