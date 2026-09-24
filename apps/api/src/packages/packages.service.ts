import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { BillingService } from '../billing/billing.service';
import { Clock } from '../common/clock';
import { isUniqueViolation } from '../common/errors/database.errors';
import {
  DomainError,
  InvalidPickupCodeError,
  LockerEmptyError,
  LockerNotFoundError,
  NoSuitableLockerError,
  NotYourPackageError,
  PackageNotFoundError,
  PickupCodeGenerationError,
  PickupCodeUnavailableError,
  PickupLockedError,
} from '../common/errors/domain.errors';
import { DB } from '../database/constraints';
import { LockerSize } from '../lockers/locker-size';
import { LockerStatus } from '../lockers/locker-status';
import { LockerEventsService } from '../lockers/locker-events.service';
import { Mailer } from '../mail/mailer';
import { publicLabel } from '../users/user.entity';
import { UserRole } from '../users/user-role';
import { UsersService } from '../users/users.service';
import { LockersRepository } from '../lockers/lockers.repository';
import { StorageCharge, StoragePricingStrategy } from '../pricing/storage-pricing.strategy';
import { Package } from './package.entity';
import { PackageStatus } from './package-status';
import { PackagesRepository } from './packages.repository';
import { PickupCodeGenerator } from './pickup-code/pickup-code.generator';
import { PickupCodeCipher } from './pickup-code/pickup-code.cipher';
import { PickupCodeHasher } from './pickup-code/pickup-code.hasher';
import { PickupLockoutPolicy } from './pickup-code/pickup-lockout.policy';

export interface StorePackageInput {
  size: LockerSize;
  /** Id of the CUSTOMER user the package is addressed to. */
  customerId: string;
}

/** Who is acting, so ownership rules can be applied. */
export interface Actor {
  id: string;
  role: UserRole;
}

export interface StoredPackage {
  packageId: string;
  lockerId: string;
  lockerLabel: string;
  lockerSize: LockerSize;
  packageSize: LockerSize;
  pickupCode: string;
  storedAt: Date;
  customer: { id: string; label: string };
  /** Whether the pickup code was emailed to the customer. */
  notified: boolean;
}

export interface RetrievePackageInput {
  lockerId: string;
  pickupCode: string;
}

export interface RetrievedPackage {
  packageId: string;
  lockerId: string;
  lockerLabel: string;
  lockerOpened: true;
  storedAt: Date;
  retrievedAt: Date;
  storageCharge: StorageCharge;
}

/** How many fresh codes to try when one collides with another active code (astronomically rare). */
export const MAX_PICKUP_CODE_ATTEMPTS = 3;

export interface ChargesSummary {
  currency: string;
  /** Packages still in lockers, and what they have run up so far. */
  outstanding: { packages: number; amount: number };
  /** Packages already collected, and what was charged for them. */
  collected: { packages: number; amount: number };
}

/** Outcome of the retrieval transaction: the commit must happen before a rejection is thrown. */
type RetrievalOutcome =
  | { ok: true; value: RetrievedPackage; lockerSize: LockerSize; customerUserId: string | null }
  | { ok: false; error: DomainError };

/**
 * The two business operations of the system. Both run as a single database transaction with the
 * locker row locked, so locker status and the package rows can never disagree.
 */
@Injectable()
export class PackagesService {
  private readonly logger = new Logger(PackagesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly lockersRepository: LockersRepository,
    private readonly packagesRepository: PackagesRepository,
    private readonly codeGenerator: PickupCodeGenerator,
    private readonly codeHasher: PickupCodeHasher,
    private readonly codeCipher: PickupCodeCipher,
    private readonly pricing: StoragePricingStrategy,
    private readonly lockoutPolicy: PickupLockoutPolicy,
    private readonly clock: Clock,
    private readonly lockerEvents: LockerEventsService,
    private readonly usersService: UsersService,
    private readonly mailer: Mailer,
    private readonly billing: BillingService,
  ) {}

  /**
   * Level 1 + 4: assign the smallest available locker that fits, mark it occupied, issue a code.
   * Concurrency safety comes from `lockSmallestAvailable` (FOR UPDATE SKIP LOCKED) plus the
   * partial unique index on packages(locker_id) as a last line of defence.
   */
  async store(input: StorePackageInput): Promise<StoredPackage> {
    const customer = await this.usersService.requireActiveCustomer(input.customerId);
    const customerLabel = publicLabel(customer);

    for (let attempt = 1; attempt <= MAX_PICKUP_CODE_ATTEMPTS; attempt++) {
      const pickupCode = this.codeGenerator.generate();
      const pickupCodeHash = this.codeHasher.hash(pickupCode);
      const pickupCodeEncrypted = this.codeCipher.encrypt(pickupCode);

      try {
        const stored = await this.dataSource.transaction(async (manager) => {
          const locker = await this.lockersRepository.lockSmallestAvailable(input.size, manager);
          if (!locker) throw new NoSuitableLockerError(input.size);

          const storedAt = this.clock.now();
          const pkg = await this.packagesRepository.insertStored(
            {
              lockerId: locker.id,
              size: input.size,
              customerUserId: customer.id,
              pickupCodeHash,
              pickupCodeEncrypted,
              storedAt,
            },
            manager,
          );
          await this.lockersRepository.setStatus(locker.id, LockerStatus.OCCUPIED, manager);

          return {
            packageId: pkg.id,
            lockerId: locker.id,
            lockerLabel: locker.label,
            lockerSize: locker.size,
            packageSize: pkg.size,
            pickupCode,
            storedAt: pkg.storedAt,
            customer: { id: customer.id, label: customerLabel },
            notified: false,
          };
        });
        this.logger.log(
          `Stored package ${stored.packageId} (${stored.packageSize}) in locker ${stored.lockerId} (${stored.lockerLabel})`,
        );
        this.lockerEvents.publish({
          type: 'package.stored',
          lockerId: stored.lockerId,
          lockerLabel: stored.lockerLabel,
          lockerSize: stored.lockerSize,
          status: LockerStatus.OCCUPIED,
          packageId: stored.packageId,
          customerLabel,
        });
        // The brief's "external notification system": after the commit, never before it.
        stored.notified = await this.notifyCustomer(customer.email, stored);
        return stored;
      } catch (error) {
        if (!isUniqueViolation(error, DB.ACTIVE_PICKUP_CODE_UNIQUE)) throw error;
        if (attempt >= MAX_PICKUP_CODE_ATTEMPTS) {
          this.logger.error(`Pickup code collided ${attempt} times in a row; giving up`);
          throw new PickupCodeGenerationError(MAX_PICKUP_CODE_ATTEMPTS);
        }
        this.logger.warn(`Pickup code collision on attempt ${attempt}; generating a new code`);
      }
    }
    /* istanbul ignore next -- unreachable: the loop either returns or throws */
    throw new PickupCodeGenerationError(MAX_PICKUP_CODE_ATTEMPTS);
  }

  /**
   * Level 2 + 3: validate locker + code, compute the storage charge, release the locker.
   * The locker row is locked (waiting, not skipping) so a retrieval and a concurrent store on the
   * same locker serialise correctly. A wrong code is *recorded* (failed-attempt counter, lockout)
   * before the rejection is thrown, which is why the transaction returns an outcome instead of
   * throwing from inside it.
   */
  async retrieve(input: RetrievePackageInput, actor: Actor): Promise<RetrievedPackage> {
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<RetrievalOutcome> => {
        const locker = await this.lockersRepository.lockById(input.lockerId, manager);
        if (!locker) return { ok: false, error: new LockerNotFoundError(input.lockerId) };

        const pkg = await this.packagesRepository.findStoredByLocker(locker.id, manager);
        if (!pkg) return { ok: false, error: new LockerEmptyError(locker.id) };

        // Customers collect their own packages; admins may assist with any (agents never collect).
        if (actor.role === UserRole.CUSTOMER && pkg.customerUserId !== actor.id) {
          return { ok: false, error: new NotYourPackageError(locker.id) };
        }

        const now = this.clock.now();
        if (pkg.pickupLockedUntil && pkg.pickupLockedUntil > now) {
          return { ok: false, error: new PickupLockedError(locker.id, pkg.pickupLockedUntil) };
        }

        if (!this.codeHasher.verify(input.pickupCode, pkg.pickupCodeHash)) {
          // A lockout that has expired starts the count over.
          const failedPickupAttempts = pkg.pickupLockedUntil ? 1 : pkg.failedPickupAttempts + 1;
          const lockedOut = failedPickupAttempts >= this.lockoutPolicy.maxFailedAttempts;
          const pickupLockedUntil = lockedOut
            ? new Date(now.getTime() + this.lockoutPolicy.lockoutMs)
            : null;
          await this.packagesRepository.recordFailedAttempt(
            pkg.id,
            { failedPickupAttempts, pickupLockedUntil },
            manager,
          );
          return {
            ok: false,
            error: pickupLockedUntil
              ? new PickupLockedError(locker.id, pickupLockedUntil)
              : new InvalidPickupCodeError(),
          };
        }

        const storageCharge = this.pricing.quote(pkg.storedAt, now);
        await this.packagesRepository.markRetrieved(
          pkg.id,
          {
            retrievedAt: now,
            storageCharge: storageCharge.amount,
            chargedDays: storageCharge.chargedDays,
          },
          manager,
        );
        await this.lockersRepository.setStatus(locker.id, LockerStatus.AVAILABLE, manager);

        // Bill the collection in the same transaction: the ledger and the package agree or neither moves.
        if (pkg.customerUserId) {
          await this.billing.billCollection(
            {
              customerUserId: pkg.customerUserId,
              packageId: pkg.id,
              amount: storageCharge.amount,
              currency: storageCharge.currency,
              description: `Storage for ${storageCharge.chargedDays} day(s) in locker ${locker.label}`,
              occurredAt: now,
            },
            manager,
          );
        }

        return {
          ok: true,
          value: {
            packageId: pkg.id,
            lockerId: locker.id,
            lockerLabel: locker.label,
            lockerOpened: true,
            storedAt: pkg.storedAt,
            retrievedAt: now,
            storageCharge,
          },
          lockerSize: locker.size,
          customerUserId: pkg.customerUserId,
        };
      },
    );

    if (!outcome.ok) {
      this.logger.warn(`Rejected pickup for locker ${input.lockerId}: ${outcome.error.code}`);
      throw outcome.error;
    }
    const { value } = outcome;
    const owner = outcome.customerUserId
      ? (await this.usersService.labelsFor([outcome.customerUserId])).get(outcome.customerUserId)
      : undefined;
    this.lockerEvents.publish({
      type: 'package.retrieved',
      lockerId: value.lockerId,
      lockerLabel: value.lockerLabel,
      lockerSize: outcome.lockerSize,
      status: LockerStatus.AVAILABLE,
      packageId: value.packageId,
      customerLabel: owner ? publicLabel(owner) : undefined,
    });
    this.logger.log(
      `Released locker ${value.lockerId} (${value.lockerLabel}); package ${value.packageId} retrieved after ` +
        `${value.storageCharge.totalDays} day(s), charge ${value.storageCharge.amount} ${value.storageCharge.currency}`,
    );
    return value;
  }

  async getById(id: string, actor: Actor): Promise<Package> {
    const pkg = await this.packagesRepository.findById(id);
    if (!pkg) throw new PackageNotFoundError(id);
    if (actor.role === UserRole.CUSTOMER && pkg.customerUserId !== actor.id)
      throw new PackageNotFoundError(id);
    return pkg;
  }

  /**
   * Admin only (enforced at the route): the code of the package waiting in a locker, so it can be read
   * out to a customer who cannot reach their email. Every reveal is logged with the admin's id.
   */
  async revealPickupCode(
    lockerId: string,
    actor: Actor,
  ): Promise<{ lockerLabel: string; pickupCode: string; customerLabel: string }> {
    const locker = await this.lockersRepository.findByIdWithCurrentPackage(lockerId);
    if (!locker) throw new LockerNotFoundError(lockerId);
    const pkg = await this.packagesRepository.findStoredByLocker(locker.id);
    if (!pkg) throw new LockerEmptyError(locker.id);
    const pickupCode = pkg.pickupCodeEncrypted
      ? this.codeCipher.decrypt(pkg.pickupCodeEncrypted)
      : null;
    if (!pickupCode) throw new PickupCodeUnavailableError(locker.id);

    const owner = pkg.customerUserId
      ? (await this.usersService.labelsFor([pkg.customerUserId])).get(pkg.customerUserId)
      : undefined;
    this.logger.warn(
      `Admin ${actor.id} revealed the pickup code for locker ${locker.id} (${locker.label})`,
    );
    return {
      lockerLabel: locker.label,
      pickupCode,
      customerLabel: owner ? publicLabel(owner) : (pkg.customerId ?? 'unknown'),
    };
  }

  /** The acting customer's packages, newest first. */
  async listMine(actor: Actor, limit = 50): Promise<Package[]> {
    return this.packagesRepository.findByCustomer(actor.id, limit);
  }

  /**
   * What a package waiting in a locker would cost if it were collected right now. Deliberately not
   * stored: it changes with every passing day. The amount that *is* recorded is the one charged at
   * collection (`storage_charge`), which this returns for a package already retrieved.
   */
  chargeSoFar(pkg: Package): StorageCharge {
    if (pkg.status === PackageStatus.RETRIEVED && pkg.retrievedAt) {
      return this.pricing.quote(pkg.storedAt, pkg.retrievedAt);
    }
    return this.pricing.quote(pkg.storedAt, this.clock.now());
  }

  /** Station totals: what is owed on packages still waiting, and what has been charged on collection. */
  async chargesSummary(): Promise<ChargesSummary> {
    const waiting = await this.packagesRepository.findAllStored();
    const now = this.clock.now();
    const quotes = waiting.map((pkg) => this.pricing.quote(pkg.storedAt, now));
    const outstandingAmount = Math.round(quotes.reduce((sum, q) => sum + q.amount, 0) * 100) / 100;
    const collected = await this.packagesRepository.sumCollected();

    return {
      currency: quotes[0]?.currency ?? this.pricing.quote(now, now).currency,
      outstanding: { packages: waiting.length, amount: outstandingAmount },
      collected: { packages: collected.packages, amount: Math.round(collected.amount * 100) / 100 },
    };
  }

  private async notifyCustomer(email: string, stored: StoredPackage): Promise<boolean> {
    try {
      await this.mailer.send({
        to: email,
        subject: `Your package is in locker ${stored.lockerLabel}`,
        text:
          `A package has been placed in locker ${stored.lockerLabel} for you.\n\n` +
          `Pickup code: ${stored.pickupCode}\n\n` +
          `Enter the locker and this code at the kiosk to collect it. Storage charges may apply after extended periods.`,
        html:
          `<p>A package has been placed in locker <strong>${stored.lockerLabel}</strong> for you.</p>` +
          `<p>Pickup code</p><p style="font-size:28px;letter-spacing:6px;font-family:monospace"><strong>${stored.pickupCode}</strong></p>` +
          `<p>Enter the locker and this code at the kiosk to collect it. Storage charges may apply after extended periods.</p>`,
      });
      return true;
    } catch (error) {
      // The package is stored and the code is in the API response; a mail outage must not undo that.
      this.logger.error(
        `Could not email pickup code for package ${stored.packageId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }
}
