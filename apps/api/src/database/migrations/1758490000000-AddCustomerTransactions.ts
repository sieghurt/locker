import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An append-only ledger per customer. A row is written when a package is collected (what the storage
 * cost) and when an admin records a payment. `amount` is signed: positive increases what the customer
 * owes, negative settles it, so the balance is simply SUM(amount).
 */
export class AddCustomerTransactions1758490000000 implements MigrationInterface {
  name = 'AddCustomerTransactions1758490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "transaction_type" AS ENUM ('CHARGE', 'PAYMENT', 'ADJUSTMENT')`,
    );

    await queryRunner.query(`
      CREATE TABLE "customer_transactions" (
        "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "customer_user_id" uuid               NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
        "type"             "transaction_type" NOT NULL,
        "amount"           numeric(12, 2)     NOT NULL,
        "currency"         varchar(12)        NOT NULL,
        "description"      varchar(200)       NOT NULL,
        "package_id"       uuid               NULL REFERENCES "packages" ("id") ON DELETE SET NULL,
        "recorded_by_user_id" uuid            NULL REFERENCES "users" ("id") ON DELETE SET NULL,
        "occurred_at"      timestamptz        NOT NULL DEFAULT now(),
        "created_at"       timestamptz        NOT NULL DEFAULT now(),
        CONSTRAINT "ck_transaction_amount_sign" CHECK (
          ("type" = 'CHARGE'  AND "amount" > 0) OR
          ("type" = 'PAYMENT' AND "amount" < 0) OR
          ("type" = 'ADJUSTMENT' AND "amount" <> 0)
        )
      )
    `);
    // A package is charged for once: a second attempt to bill the same collection is refused.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "ux_transactions_one_charge_per_package"
        ON "customer_transactions" ("package_id") WHERE "type" = 'CHARGE' AND "package_id" IS NOT NULL
    `);
    // Serves the statement query: a customer's rows, newest first.
    await queryRunner.query(`
      CREATE INDEX "ix_transactions_customer_occurred"
        ON "customer_transactions" ("customer_user_id", "occurred_at" DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "customer_transactions"`);
    await queryRunner.query(`DROP TYPE "transaction_type"`);
  }
}
