import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { EnvironmentVariables } from '../config/environment';
import { LockerSize } from './locker-size';
import { UserRole } from '../users/user-role';
import { UsersService } from '../users/users.service';
import { LockersService } from './lockers.service';

/**
 * Convenience for local demos: when SEED_LOCKERS is set and the table is empty, creates that
 * inventory on boot. Never touches a table that already has lockers, so it is safe to leave on.
 */
@Injectable()
export class LockerSeederService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LockerSeederService.name);

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly lockersService: LockersService,
    private readonly usersService: UsersService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.seedUsers();
    await this.seedLockers();
  }

  /** First admin (SEED_ADMIN_EMAIL) and optional demo accounts (SEED_USERS), only into an empty users table. */
  private async seedUsers(): Promise<void> {
    const admin = this.config.get('SEED_ADMIN_EMAIL', { infer: true })?.trim().toLowerCase();
    const extra = this.config.get('SEED_USERS', { infer: true });
    if (!admin && !extra) return;
    if ((await this.usersService.count()) > 0) {
      this.logger.log('Skipping user seed: users already exist');
      return;
    }
    if (admin) {
      await this.usersService.create({ email: admin, role: UserRole.ADMIN, displayName: 'Admin' });
      this.logger.log(`Seeded admin account *@${admin.split('@')[1] ?? '?'}`);
    }
    for (const { email, role } of LockerSeederService.parseUsers(extra ?? '')) {
      await this.usersService.create({ email, role, displayName: email.split('@')[0] });
    }
    if (extra) this.logger.log('Seeded demo users from SEED_USERS');
  }

  /** "alice@x.io:CUSTOMER,bob@x.io:AGENT" -> [{ email, role }] */
  static parseUsers(spec: string): Array<{ email: string; role: UserRole }> {
    return spec
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [rawEmail, rawRole] = part.split(':');
        const email = rawEmail?.trim().toLowerCase() ?? '';
        const role = rawRole?.trim().toUpperCase() as UserRole;
        if (!email.includes('@') || !Object.values(UserRole).includes(role)) {
          throw new Error(`Invalid SEED_USERS entry "${part}"; expected email:ROLE`);
        }
        return { email, role };
      });
  }

  private async seedLockers(): Promise<void> {
    const spec = this.config.get('SEED_LOCKERS', { infer: true });
    if (!spec) return;

    const existing = await this.lockersService.count();
    if (existing > 0) {
      this.logger.log(`Skipping locker seed: ${existing} locker(s) already exist`);
      return;
    }

    const plan = LockerSeederService.parse(spec);
    let created = 0;
    for (const { size, count } of plan) {
      for (let i = 1; i <= count; i++) {
        const label = `${size.charAt(0)}-${String(i).padStart(2, '0')}`;
        await this.lockersService.create({ label, size });
        created++;
      }
    }
    this.logger.log(`Seeded ${created} locker(s) from SEED_LOCKERS="${spec}"`);
  }

  /** "SMALL:3,MEDIUM:2" -> [{ size: SMALL, count: 3 }, { size: MEDIUM, count: 2 }] */
  static parse(spec: string): Array<{ size: LockerSize; count: number }> {
    return spec
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [rawSize, rawCount] = part.split(':');
        const size = rawSize?.trim().toUpperCase() as LockerSize;
        const count = Number.parseInt(rawCount ?? '', 10);
        if (!Object.values(LockerSize).includes(size) || !Number.isInteger(count) || count < 0) {
          throw new Error(`Invalid SEED_LOCKERS entry "${part}"; expected SIZE:COUNT`);
        }
        return { size, count };
      });
  }
}
