import { Injectable, Logger } from '@nestjs/common';

import { isUniqueViolation } from '../common/errors/database.errors';
import { DB } from '../database/constraints';
import { LockerLabelTakenError, LockerNotFoundError } from '../common/errors/domain.errors';
import { CreateLockerDto } from './dto/create-locker.dto';
import { ListLockersQuery } from './dto/list-lockers.query';
import { Locker } from './locker.entity';
import { Clock } from '../common/clock';
import { StorageCharge, StoragePricingStrategy } from '../pricing/storage-pricing.strategy';
import { publicLabel } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { LockerEventsService } from './locker-events.service';
import { LockersRepository } from './lockers.repository';

@Injectable()
export class LockersService {
  private readonly logger = new Logger(LockersService.name);

  constructor(
    private readonly lockersRepository: LockersRepository,
    private readonly lockerEvents: LockerEventsService,
    private readonly usersService: UsersService,
    private readonly pricing: StoragePricingStrategy,
    private readonly clock: Clock,
  ) {}

  /** What the package in this locker has run up so far. Shown to admins only. */
  accruedCharge(storedAt: Date): StorageCharge {
    return this.pricing.quote(storedAt, this.clock.now());
  }

  /** Customer labels for the packages inside the given lockers, in one query. */
  async customerLabels(lockers: Locker[]): Promise<Map<string, string>> {
    const ids = lockers
      .map((l) => l.currentPackage?.customerUserId)
      .filter((id): id is string => !!id);
    const users = await this.usersService.labelsFor(ids);
    return new Map([...users].map(([id, user]) => [id, publicLabel(user)]));
  }

  async create(input: CreateLockerDto): Promise<Locker> {
    try {
      const locker = await this.lockersRepository.insert({ label: input.label, size: input.size });
      this.logger.log(`Created locker ${locker.id} (${locker.label}, ${locker.size})`);
      this.lockerEvents.publish({
        type: 'locker.created',
        lockerId: locker.id,
        lockerLabel: locker.label,
        lockerSize: locker.size,
        status: locker.status,
      });
      return locker;
    } catch (error) {
      if (isUniqueViolation(error, DB.LOCKER_LABEL_UNIQUE))
        throw new LockerLabelTakenError(input.label);
      throw error;
    }
  }

  async list(query: ListLockersQuery): Promise<{ items: Locker[]; total: number }> {
    return this.lockersRepository.findPage(
      { status: query.status, size: query.size },
      { limit: query.limit, offset: query.offset },
    );
  }

  async getById(id: string): Promise<Locker> {
    const locker = await this.lockersRepository.findByIdWithCurrentPackage(id);
    if (!locker) throw new LockerNotFoundError(id);
    return locker;
  }

  async count(): Promise<number> {
    return this.lockersRepository.count();
  }
}
