import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ValueTransformer,
} from 'typeorm';

import { LockerSize } from '../lockers/locker-size';
import { PackageStatus } from './package-status';

/** Postgres returns numeric as a string to avoid precision loss; expose it as a number (2 dp). */
const decimalTransformer: ValueTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value === null ? null : Number.parseFloat(value)),
};

@Entity({ name: 'packages' })
export class Package {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** FK to lockers.id (ON DELETE RESTRICT), enforced in the migration. */
  @Column({ name: 'locker_id', type: 'uuid' })
  lockerId!: string;

  /** Package size on the shared locker scale. */
  @Column({ type: 'enum', enum: LockerSize, enumName: 'locker_size' })
  size!: LockerSize;

  /** Free-text reference used before customer accounts existed. Null for packages stored since. */
  @Column({ name: 'customer_id', type: 'varchar', length: 64, nullable: true })
  customerId!: string | null;

  /** The customer account this package is addressed to; the only account allowed to collect it. */
  @Column({ name: 'customer_user_id', type: 'uuid', nullable: true })
  customerUserId!: string | null;

  /** HMAC-SHA256 of the pickup code, used to verify a customer's entry. */
  @Column({ name: 'pickup_code_hash', type: 'char', length: 64 })
  pickupCodeHash!: string;

  /**
   * The code encrypted (AES-256-GCM, PICKUP_CODE_ENCRYPTION_KEY) while the package is STORED so an
   * admin can read it out to a customer; wiped on retrieval. Null for packages stored before this existed.
   */
  @Column({ name: 'pickup_code_encrypted', type: 'text', nullable: true })
  pickupCodeEncrypted!: string | null;

  @Column({
    type: 'enum',
    enum: PackageStatus,
    enumName: 'package_status',
    default: PackageStatus.STORED,
  })
  status!: PackageStatus;

  @Column({ name: 'stored_at', type: 'timestamptz' })
  storedAt!: Date;

  @Column({ name: 'retrieved_at', type: 'timestamptz', nullable: true })
  retrievedAt!: Date | null;

  @Column({
    name: 'storage_charge',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
    transformer: decimalTransformer,
  })
  storageCharge!: number | null;

  @Column({ name: 'charged_days', type: 'integer', nullable: true })
  chargedDays!: number | null;

  /** Wrong codes entered for this package since it was stored (or since the last lockout expired). */
  @Column({ name: 'failed_pickup_attempts', type: 'integer', default: 0 })
  failedPickupAttempts!: number;

  /** While set and in the future, every pickup attempt is refused regardless of code. */
  @Column({ name: 'pickup_locked_until', type: 'timestamptz', nullable: true })
  pickupLockedUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
