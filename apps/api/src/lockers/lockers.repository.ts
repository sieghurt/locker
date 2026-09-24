import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { Package } from '../packages/package.entity';
import { PackageStatus } from '../packages/package-status';
import { Locker } from './locker.entity';
import { LOCKER_SIZES_ASCENDING, LockerSize, sizesThatCanHold } from './locker-size';
import { LockerStatus } from './locker-status';

export interface LockerFilter {
  status?: LockerStatus;
  size?: LockerSize;
}

export interface Page {
  limit: number;
  offset: number;
}

/**
 * All SQL touching the lockers table. Methods that take an `EntityManager` participate in the
 * caller's transaction; those that do not run on their own connection.
 */
@Injectable()
export class LockersRepository {
  constructor(@InjectRepository(Locker) private readonly lockers: Repository<Locker>) {}

  async insert(data: Pick<Locker, 'label' | 'size'>): Promise<Locker> {
    const locker = this.lockers.create({ ...data, status: LockerStatus.AVAILABLE });
    return this.lockers.save(locker);
  }

  async count(): Promise<number> {
    return this.lockers.count();
  }

  async findPage(filter: LockerFilter, page: Page): Promise<{ items: Locker[]; total: number }> {
    const qb = this.withCurrentPackage(this.lockers.createQueryBuilder('l'))
      .orderBy('l.label', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .skip(page.offset)
      .take(page.limit);

    if (filter.status) qb.andWhere('l.status = :status', { status: filter.status });
    if (filter.size) qb.andWhere('l.size = :size', { size: filter.size });

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  async findByIdWithCurrentPackage(id: string): Promise<Locker | null> {
    return this.withCurrentPackage(this.lockers.createQueryBuilder('l'))
      .where('l.id = :id', { id })
      .getOne();
  }

  /**
   * Level 4 lives here. Locks and returns the smallest AVAILABLE locker able to hold `packageSize`.
   * `FOR UPDATE SKIP LOCKED` means concurrent transactions never wait on each other and never
   * see the same row: each gets the next free locker or nothing. Must run inside a transaction.
   */
  async lockSmallestAvailable(
    packageSize: LockerSize,
    manager: EntityManager,
  ): Promise<Locker | null> {
    const fitting = sizesThatCanHold(packageSize);
    if (fitting.length === 0) return null;

    // Enum members only: never interpolate user input into this expression.
    const sizeOrder =
      'CASE l.size ' +
      LOCKER_SIZES_ASCENDING.map((size, index) => `WHEN '${size}' THEN ${index}`).join(' ') +
      ' END';

    return manager
      .createQueryBuilder(Locker, 'l')
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .where('l.status = :status', { status: LockerStatus.AVAILABLE })
      .andWhere('l.size IN (:...fitting)', { fitting })
      .orderBy(sizeOrder, 'ASC')
      .addOrderBy('l.created_at', 'ASC')
      .addOrderBy('l.id', 'ASC')
      .limit(1)
      .getOne();
  }

  /** Locks one locker for the duration of the caller's transaction (waits if another holds it). */
  async lockById(id: string, manager: EntityManager): Promise<Locker | null> {
    return manager
      .createQueryBuilder(Locker, 'l')
      .setLock('pessimistic_write')
      .where('l.id = :id', { id })
      .getOne();
  }

  async setStatus(id: string, status: LockerStatus, manager: EntityManager): Promise<void> {
    await manager.update(Locker, { id }, { status });
  }

  private withCurrentPackage<Q extends ReturnType<Repository<Locker>['createQueryBuilder']>>(
    qb: Q,
  ): Q {
    return qb.leftJoinAndMapOne(
      'l.currentPackage',
      Package,
      'p',
      'p.locker_id = l.id AND p.status = :storedStatus',
      { storedStatus: PackageStatus.STORED },
    );
  }
}
