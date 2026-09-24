import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, ILike, In, Repository } from 'typeorm';

import { User } from './user.entity';
import { UserRole } from './user-role';

export interface UserFilter {
  role?: UserRole;
  /** Case-insensitive match on email or display name. */
  q?: string;
  active?: boolean;
}

@Injectable()
export class UsersRepository {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async insert(
    data: Pick<User, 'email' | 'role'> & { displayName?: string | null },
  ): Promise<User> {
    return this.users.save(
      this.users.create({ ...data, displayName: data.displayName ?? null, active: true }),
    );
  }

  async count(): Promise<number> {
    return this.users.count();
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: email.toLowerCase() } });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.users.find({ where: { id: In(ids) } });
  }

  async findPage(
    filter: UserFilter,
    page: { limit: number; offset: number },
  ): Promise<{ items: User[]; total: number }> {
    const qb = this.users
      .createQueryBuilder('u')
      .orderBy('u.email', 'ASC')
      .skip(page.offset)
      .take(page.limit);
    if (filter.role) qb.andWhere('u.role = :role', { role: filter.role });
    if (filter.active !== undefined) qb.andWhere('u.active = :active', { active: filter.active });
    if (filter.q) {
      qb.andWhere('(u.email ILIKE :q OR u.display_name ILIKE :q)', { q: `%${filter.q}%` });
    }
    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async update(
    id: string,
    patch: Partial<Pick<User, 'role' | 'displayName' | 'active'>>,
  ): Promise<void> {
    await this.users.update({ id }, patch);
  }

  async markLoggedIn(id: string, at: Date, manager?: EntityManager): Promise<void> {
    await (manager ?? this.users.manager).update(User, { id }, { lastLoginAt: at });
  }

  /** Used by tests and the seeder to look up demo users quickly. */
  async findActiveCustomersLike(q: string): Promise<User[]> {
    return this.users.find({
      where: { role: UserRole.CUSTOMER, active: true, email: ILike(`%${q}%`) },
      take: 20,
    });
  }
}
