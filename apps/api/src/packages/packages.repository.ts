import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { LockerSize } from '../lockers/locker-size';
import { Package } from './package.entity';
import { PackageStatus } from './package-status';

export interface NewStoredPackage {
  lockerId: string;
  size: LockerSize;
  customerUserId: string;
  pickupCodeHash: string;
  pickupCodeEncrypted: string;
  storedAt: Date;
}

export interface RetrievalOutcome {
  retrievedAt: Date;
  storageCharge: number;
  chargedDays: number;
}

/** All SQL touching the packages table. Transactional methods take the caller's EntityManager. */
@Injectable()
export class PackagesRepository {
  constructor(@InjectRepository(Package) private readonly packages: Repository<Package>) {}

  async insertStored(data: NewStoredPackage, manager: EntityManager): Promise<Package> {
    const pkg = manager.create(Package, {
      ...data,
      customerId: null,
      status: PackageStatus.STORED,
      retrievedAt: null,
      storageCharge: null,
      chargedDays: null,
    });
    return manager.save(Package, pkg);
  }

  async findStoredByLocker(lockerId: string, manager?: EntityManager): Promise<Package | null> {
    return (manager ?? this.packages.manager).findOne(Package, {
      where: { lockerId, status: PackageStatus.STORED },
    });
  }

  async markRetrieved(
    id: string,
    outcome: RetrievalOutcome,
    manager: EntityManager,
  ): Promise<void> {
    await manager.update(
      Package,
      { id, status: PackageStatus.STORED },
      { status: PackageStatus.RETRIEVED, pickupCodeEncrypted: null, ...outcome },
    );
  }

  async recordFailedAttempt(
    id: string,
    state: { failedPickupAttempts: number; pickupLockedUntil: Date | null },
    manager: EntityManager,
  ): Promise<void> {
    await manager.update(Package, { id, status: PackageStatus.STORED }, state);
  }

  async findById(id: string): Promise<Package | null> {
    return this.packages.findOne({ where: { id } });
  }

  /** Every package still in a locker. Bounded: a station has as many as it has lockers. */
  async findAllStored(limit = 1000): Promise<Package[]> {
    return this.packages.find({
      where: { status: PackageStatus.STORED },
      order: { storedAt: 'ASC' },
      take: limit,
    });
  }

  /** What has actually been charged, from the amounts recorded at collection. */
  async sumCollected(): Promise<{ packages: number; amount: number }> {
    const row = await this.packages
      .createQueryBuilder('p')
      .select('COUNT(*)::int', 'packages')
      .addSelect('COALESCE(SUM(p.storage_charge), 0)::float', 'amount')
      .where('p.status = :status', { status: PackageStatus.RETRIEVED })
      .getRawOne<{ packages: number; amount: number }>();
    return { packages: row?.packages ?? 0, amount: row?.amount ?? 0 };
  }

  /** A customer's own packages, newest first; bounded because a customer's history can grow. */
  async findByCustomer(customerUserId: string, limit: number): Promise<Package[]> {
    return this.packages.find({
      where: { customerUserId },
      order: { storedAt: 'DESC' },
      take: limit,
    });
  }
}
