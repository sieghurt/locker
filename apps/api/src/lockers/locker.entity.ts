import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { Package } from '../packages/package.entity';
import { LockerSize } from './locker-size';
import { LockerStatus } from './locker-status';

@Entity({ name: 'lockers' })
export class Locker {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Operator-facing identifier printed on the physical door, e.g. "A-01". */
  @Column({ type: 'varchar', length: 32, unique: true })
  label!: string;

  @Column({ type: 'enum', enum: LockerSize, enumName: 'locker_size' })
  size!: LockerSize;

  @Column({
    type: 'enum',
    enum: LockerStatus,
    enumName: 'locker_status',
    default: LockerStatus.AVAILABLE,
  })
  status!: LockerStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  /** Populated by list/detail queries via a join on the STORED package; not a column. */
  currentPackage?: Package | null;
}
