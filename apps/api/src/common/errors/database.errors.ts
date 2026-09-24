import { QueryFailedError } from 'typeorm';

const PG_UNIQUE_VIOLATION = '23505';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

/**
 * True when `error` is a PostgreSQL unique-constraint violation, optionally on one named
 * constraint/index. Lets services turn a database race into a domain error or a retry instead of a 500.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as PgDriverError | undefined;
  if (driverError?.code !== PG_UNIQUE_VIOLATION) return false;
  return constraint === undefined || driverError.constraint === constraint;
}
