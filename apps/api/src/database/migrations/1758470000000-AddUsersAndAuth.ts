import { MigrationInterface, QueryRunner } from 'typeorm';

import { DB } from '../constraints';

/**
 * Users with roles, one-time login codes, and the link from a package to the customer it belongs to.
 * `packages.customer_id` (free-text reference from before accounts existed) becomes nullable and is
 * kept only for rows created before this migration; new packages reference a customer user.
 */
export class AddUsersAndAuth1758470000000 implements MigrationInterface {
  name = 'AddUsersAndAuth1758470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "user_role" AS ENUM ('ADMIN', 'AGENT', 'CUSTOMER')`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email"         varchar(254) NOT NULL,
        "role"          "user_role"  NOT NULL,
        "display_name"  varchar(80)  NULL,
        "active"        boolean      NOT NULL DEFAULT true,
        "last_login_at" timestamptz  NULL,
        "created_at"    timestamptz  NOT NULL DEFAULT now(),
        "updated_at"    timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "${DB.USER_EMAIL_UNIQUE}" UNIQUE ("email"),
        CONSTRAINT "ck_users_email_lowercase" CHECK ("email" = lower("email"))
      )
    `);
    await queryRunner.query(`CREATE INDEX "ix_users_role_active" ON "users" ("role", "active")`);

    await queryRunner.query(`
      CREATE TABLE "otp_codes" (
        "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"     uuid        NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
        "code_hash"   char(64)    NOT NULL,
        "expires_at"  timestamptz NOT NULL,
        "consumed_at" timestamptz NULL,
        "attempts"    integer     NOT NULL DEFAULT 0,
        "created_at"  timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "ck_otp_attempts_not_negative" CHECK ("attempts" >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_otp_codes_user_created" ON "otp_codes" ("user_id", "created_at")`,
    );

    await queryRunner.query(`ALTER TABLE "packages" ALTER COLUMN "customer_id" DROP NOT NULL`);
    await queryRunner.query(`
      ALTER TABLE "packages"
        ADD COLUMN "customer_user_id" uuid NULL REFERENCES "users" ("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_packages_customer_user_id" ON "packages" ("customer_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "packages" DROP COLUMN "customer_user_id"`);
    // `customer_id` stays nullable: packages stored after this migration reference an account instead,
    // so restoring NOT NULL would fail on their null values. Reversing this is a data decision.
    await queryRunner.query(`DROP TABLE "otp_codes"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "user_role"`);
  }
}
