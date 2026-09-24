import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  ValueTransformer,
} from 'typeorm';

import { TransactionType } from './transaction-type';

/** Postgres returns numeric as a string to avoid precision loss; expose it as a number (2 dp). */
const decimal: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? 0 : Number.parseFloat(value)),
};

@Entity({ name: 'customer_transactions' })
export class CustomerTransaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'customer_user_id', type: 'uuid' })
  customerUserId!: string;

  @Column({ type: 'enum', enum: TransactionType, enumName: 'transaction_type' })
  type!: TransactionType;

  /** Signed: positive is owed by the customer, negative settles it. Balance = SUM(amount). */
  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: decimal })
  amount!: number;

  @Column({ type: 'varchar', length: 12 })
  currency!: string;

  @Column({ type: 'varchar', length: 200 })
  description!: string;

  /** The collection this charge is for; null for payments and adjustments. */
  @Column({ name: 'package_id', type: 'uuid', nullable: true })
  packageId!: string | null;

  /** The admin who recorded it; null when the system billed a collection. */
  @Column({ name: 'recorded_by_user_id', type: 'uuid', nullable: true })
  recordedByUserId!: string | null;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
