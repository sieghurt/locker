import { MigrationInterface, QueryRunner } from 'typeorm';

import { DB } from '../constraints';

/**
 * Lockers and packages, with the integrity rules enforced in the database rather than only in code:
 *  - a locker can hold at most one STORED package (partial unique index on packages.locker_id)
 *  - an active (STORED) pickup code is unique across the system (partial unique index on the hash)
 *  - a RETRIEVED package always carries its retrieval time and charge; a STORED one never does
 *  - wrong pickup codes are counted per package so a locker can be locked out after too many guesses
 */
export class InitialSchema1758380000000 implements MigrationInterface {
  name = 'InitialSchema1758380000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "locker_size" AS ENUM ('SMALL', 'MEDIUM', 'LARGE')`);
    await queryRunner.query(`CREATE TYPE "locker_status" AS ENUM ('AVAILABLE', 'OCCUPIED')`);
    await queryRunner.query(`CREATE TYPE "package_status" AS ENUM ('STORED', 'RETRIEVED')`);

    await queryRunner.query(`
      CREATE TABLE "lockers" (
        "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "label"      varchar(32)     NOT NULL,
        "size"       "locker_size"   NOT NULL,
        "status"     "locker_status" NOT NULL DEFAULT 'AVAILABLE',
        "created_at" timestamptz     NOT NULL DEFAULT now(),
        "updated_at" timestamptz     NOT NULL DEFAULT now(),
        CONSTRAINT "${DB.LOCKER_LABEL_UNIQUE}" UNIQUE ("label")
      )
    `);
    // Serves the allocation query: WHERE status = 'AVAILABLE' AND size IN (...)
    await queryRunner.query(
      `CREATE INDEX "ix_lockers_status_size" ON "lockers" ("status", "size")`,
    );

    await queryRunner.query(`
      CREATE TABLE "packages" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "locker_id"        uuid             NOT NULL,
        "size"             "locker_size"    NOT NULL,
        "customer_id"      varchar(64)      NOT NULL,
        "pickup_code_hash" char(64)         NOT NULL,
        "status"           "package_status" NOT NULL DEFAULT 'STORED',
        "stored_at"        timestamptz      NOT NULL DEFAULT now(),
        "retrieved_at"     timestamptz      NULL,
        "storage_charge"   numeric(12, 2)   NULL,
        "charged_days"     integer          NULL,
        "failed_pickup_attempts" integer    NOT NULL DEFAULT 0,
        "pickup_locked_until"    timestamptz NULL,
        "created_at"       timestamptz      NOT NULL DEFAULT now(),
        "updated_at"       timestamptz      NOT NULL DEFAULT now(),
        CONSTRAINT "fk_packages_locker" FOREIGN KEY ("locker_id")
          REFERENCES "lockers" ("id") ON DELETE RESTRICT,
        CONSTRAINT "ck_packages_status_fields" CHECK (
          ("status" = 'STORED'
            AND "retrieved_at" IS NULL AND "storage_charge" IS NULL AND "charged_days" IS NULL)
          OR
          ("status" = 'RETRIEVED'
            AND "retrieved_at" IS NOT NULL AND "storage_charge" IS NOT NULL AND "charged_days" IS NOT NULL)
        ),
        CONSTRAINT "ck_packages_retrieved_after_stored" CHECK (
          "retrieved_at" IS NULL OR "retrieved_at" >= "stored_at"
        ),
        CONSTRAINT "ck_packages_charge_not_negative" CHECK (
          "storage_charge" IS NULL OR "storage_charge" >= 0
        ),
        CONSTRAINT "ck_packages_failed_attempts_not_negative" CHECK (
          "failed_pickup_attempts" >= 0
        )
      )
    `);

    // The hard guarantee behind "a locker can store only one package at a time".
    await queryRunner.query(`
      CREATE UNIQUE INDEX "${DB.ONE_STORED_PACKAGE_PER_LOCKER}"
        ON "packages" ("locker_id") WHERE "status" = 'STORED'
    `);
    // The hard guarantee behind "each stored package must have a unique pickup code".
    await queryRunner.query(`
      CREATE UNIQUE INDEX "${DB.ACTIVE_PICKUP_CODE_UNIQUE}"
        ON "packages" ("pickup_code_hash") WHERE "status" = 'STORED'
    `);
    await queryRunner.query(`CREATE INDEX "ix_packages_locker_id" ON "packages" ("locker_id")`);
    await queryRunner.query(`CREATE INDEX "ix_packages_customer_id" ON "packages" ("customer_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "packages"`);
    await queryRunner.query(`DROP TABLE "lockers"`);
    await queryRunner.query(`DROP TYPE "package_status"`);
    await queryRunner.query(`DROP TYPE "locker_status"`);
    await queryRunner.query(`DROP TYPE "locker_size"`);
  }
}
