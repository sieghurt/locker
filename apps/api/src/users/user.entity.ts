import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { UserRole } from './user-role';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Stored lowercase; the only credential a user has (login is by one-time code sent here). */
  @Column({ type: 'varchar', length: 254, unique: true })
  email!: string;

  @Column({ type: 'enum', enum: UserRole, enumName: 'user_role' })
  role!: UserRole;

  @Column({ name: 'display_name', type: 'varchar', length: 80, nullable: true })
  displayName!: string | null;

  /** Inactive users cannot log in and cannot be chosen as a package recipient. */
  @Column({ type: 'boolean', default: true })
  active!: boolean;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}

/** What other users may see about a user: never the full email. */
export function publicLabel(user: Pick<User, 'email' | 'displayName'>): string {
  if (user.displayName) return user.displayName;
  const [local, domain] = user.email.split('@');
  const shown = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${shown}***@${domain}`;
}
