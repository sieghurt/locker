import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a station admin read the pickup code of a package that is waiting in a locker. The HMAC used
 * for verification stays; alongside it the code is kept encrypted (AES-256-GCM, separate key) while
 * the package is STORED and wiped on retrieval. Packages stored before this migration have no
 * recoverable code.
 */
export class AddRecoverablePickupCode1758480000000 implements MigrationInterface {
  name = 'AddRecoverablePickupCode1758480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "packages" ADD COLUMN "pickup_code_encrypted" text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "packages" DROP COLUMN "pickup_code_encrypted"`);
  }
}
