import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';

import { InitialSchema1758380000000 } from '../database/migrations/1758380000000-InitialSchema';
import { AddUsersAndAuth1758470000000 } from '../database/migrations/1758470000000-AddUsersAndAuth';
import { AddRecoverablePickupCode1758480000000 } from '../database/migrations/1758480000000-AddRecoverablePickupCode';
import { AddCustomerTransactions1758490000000 } from '../database/migrations/1758490000000-AddCustomerTransactions';
import { CustomerTransaction } from '../billing/customer-transaction.entity';
import { OtpCode } from '../auth/otp-code.entity';
import { User } from '../users/user.entity';
import { Locker } from '../lockers/locker.entity';
import { Package } from '../packages/package.entity';

export interface DatabaseConnectionSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
}

/**
 * Single source of truth for the TypeORM connection: used by the Nest DatabaseModule at runtime
 * and by the TypeORM CLI (`npm run migration:*`). Entities and migrations are listed explicitly so
 * the same code works from `src/` (ts-node) and from `dist/` (compiled) without glob juggling.
 */
export function buildDataSourceOptions(settings: DatabaseConnectionSettings): DataSourceOptions {
  return {
    type: 'postgres',
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    database: settings.database,
    // Encrypts the connection but does not verify the server certificate (fine for RDS-style
    // managed hosts in a challenge; pin a CA bundle for production).
    ssl: settings.ssl ? { rejectUnauthorized: false } : false,
    entities: [Locker, Package, User, OtpCode, CustomerTransaction],
    migrations: [
      InitialSchema1758380000000,
      AddUsersAndAuth1758470000000,
      AddRecoverablePickupCode1758480000000,
      AddCustomerTransactions1758490000000,
    ],
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    logging: false,
  };
}

function settingsFromProcessEnv(): DatabaseConnectionSettings {
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    username: process.env.DB_USER ?? 'locker',
    password: process.env.DB_PASSWORD ?? 'locker',
    database: process.env.DB_NAME ?? 'locker',
    ssl: (process.env.DB_SSL ?? 'false').toLowerCase() === 'true',
  };
}

/** Consumed by the TypeORM CLI only. */
export default new DataSource(buildDataSourceOptions(settingsFromProcessEnv()));
