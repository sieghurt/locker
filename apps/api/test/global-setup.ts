import 'reflect-metadata';
import './e2e.env';

import { DataSource } from 'typeorm';

import { buildDataSourceOptions } from '../src/config/typeorm.datasource';

/**
 * Migrates the test database exactly once before any suite boots. Suites then start against a
 * ready schema, so two application boots can never race each other on CREATE TYPE / CREATE TABLE.
 */
export default async function globalSetup(): Promise<void> {
  const dataSource = new DataSource(
    buildDataSourceOptions({
      host: process.env.DB_HOST!,
      port: Number(process.env.DB_PORT),
      username: process.env.DB_USER!,
      password: process.env.DB_PASSWORD!,
      database: process.env.DB_NAME!,
      ssl: process.env.DB_SSL === 'true',
    }),
  );
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
