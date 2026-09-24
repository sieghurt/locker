import { Injectable, Logger } from '@nestjs/common';

import { isUniqueViolation } from '../common/errors/database.errors';
import {
  CustomerNotFoundError,
  EmailTakenError,
  UserNotFoundError,
} from '../common/errors/domain.errors';
import { DB } from '../database/constraints';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './user.entity';
import { UserRole } from './user-role';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly users: UsersRepository) {}

  async create(input: CreateUserDto): Promise<User> {
    try {
      const user = await this.users.insert({
        email: input.email,
        role: input.role,
        displayName: input.displayName ?? null,
      });
      this.logger.log(`Created ${user.role} user ${user.id}`);
      return user;
    } catch (error) {
      if (isUniqueViolation(error, DB.USER_EMAIL_UNIQUE)) throw new EmailTakenError();
      throw error;
    }
  }

  async list(query: ListUsersQuery): Promise<{ items: User[]; total: number }> {
    return this.users.findPage(
      { role: query.role, q: query.q, active: query.active },
      { limit: query.limit, offset: query.offset },
    );
  }

  async getById(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) throw new UserNotFoundError(id);
    return user;
  }

  async update(id: string, patch: UpdateUserDto): Promise<User> {
    await this.getById(id);
    await this.users.update(id, patch);
    this.logger.log(`Updated user ${id}: ${Object.keys(patch).join(', ')}`);
    return this.getById(id);
  }

  /** A package can only be stored for an active customer account. */
  async requireActiveCustomer(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user || !user.active || user.role !== UserRole.CUSTOMER)
      throw new CustomerNotFoundError(id);
    return user;
  }

  async labelsFor(ids: string[]): Promise<Map<string, User>> {
    const found = await this.users.findByIds([...new Set(ids)]);
    return new Map(found.map((u) => [u.id, u]));
  }

  async count(): Promise<number> {
    return this.users.count();
  }
}
