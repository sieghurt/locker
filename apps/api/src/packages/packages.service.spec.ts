import { DataSource, EntityManager, QueryFailedError } from 'typeorm';

import { Clock } from '../common/clock';
import {
  InvalidPickupCodeError,
  LockerEmptyError,
  LockerNotFoundError,
  NoSuitableLockerError,
  NotYourPackageError,
  PickupCodeGenerationError,
  PickupCodeUnavailableError,
  PickupLockedError,
} from '../common/errors/domain.errors';
import { DB } from '../database/constraints';
import { Locker } from '../lockers/locker.entity';
import { LockerSize } from '../lockers/locker-size';
import { LockerStatus } from '../lockers/locker-status';
import { BillingService } from '../billing/billing.service';
import { LockerEventsService } from '../lockers/locker-events.service';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role';
import { UsersService } from '../users/users.service';
import { LockersRepository } from '../lockers/lockers.repository';
import { StoragePricingStrategy } from '../pricing/storage-pricing.strategy';
import { TieredPricingStrategy } from '../pricing/tiered-pricing.strategy';
import { Package } from './package.entity';
import { PackageStatus } from './package-status';
import { PackagesRepository } from './packages.repository';
import { MAX_PICKUP_CODE_ATTEMPTS, PackagesService } from './packages.service';
import { PickupCodeGenerator } from './pickup-code/pickup-code.generator';
import { PickupCodeCipher } from './pickup-code/pickup-code.cipher';
import { PickupCodeHasher } from './pickup-code/pickup-code.hasher';
import { PickupLockoutPolicy } from './pickup-code/pickup-lockout.policy';

const NOW = new Date('2026-03-10T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const CUSTOMER: User = {
  id: 'cust-1',
  email: 'alice@example.com',
  role: UserRole.CUSTOMER,
  displayName: 'Alice',
  active: true,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};
const CIPHER = new PickupCodeCipher('unit-test-encryption-key-unit-test-0000');
const asCustomer = { id: CUSTOMER.id, role: UserRole.CUSTOMER };
const asAdmin = { id: 'admin-1', role: UserRole.ADMIN };

const locker = (overrides: Partial<Locker> = {}): Locker => ({
  id: 'locker-1',
  label: 'A-01',
  size: LockerSize.MEDIUM,
  status: LockerStatus.AVAILABLE,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const storedPackage = (
  hasher: PickupCodeHasher,
  code: string,
  overrides: Partial<Package> = {},
): Package => ({
  id: 'pkg-1',
  lockerId: 'locker-1',
  size: LockerSize.SMALL,
  customerId: null,
  customerUserId: CUSTOMER.id,
  pickupCodeHash: hasher.hash(code),
  pickupCodeEncrypted: CIPHER.encrypt(code),
  status: PackageStatus.STORED,
  storedAt: NOW,
  retrievedAt: null,
  storageCharge: null,
  chargedDays: null,
  failedPickupAttempts: 0,
  pickupLockedUntil: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

const uniqueViolation = (constraint: string) =>
  new QueryFailedError(
    'INSERT',
    [],
    Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
  );

describe('PackagesService', () => {
  const manager = { id: 'fake-manager' } as unknown as EntityManager;
  let dataSource: { transaction: jest.Mock };
  let lockers: jest.Mocked<
    Pick<
      LockersRepository,
      'lockSmallestAvailable' | 'lockById' | 'setStatus' | 'findByIdWithCurrentPackage'
    >
  >;
  let packages: jest.Mocked<
    Pick<
      PackagesRepository,
      | 'insertStored'
      | 'findStoredByLocker'
      | 'markRetrieved'
      | 'recordFailedAttempt'
      | 'findAllStored'
      | 'sumCollected'
    >
  >;
  let codes: jest.Mocked<PickupCodeGenerator>;
  let hasher: PickupCodeHasher;
  let pricing: StoragePricingStrategy;
  let events: LockerEventsService;
  let publish: jest.SpyInstance;
  let usersService: { requireActiveCustomer: jest.Mock; labelsFor: jest.Mock };
  let mailer: { send: jest.Mock };
  let billing: { billCollection: jest.Mock };
  let service: PackagesService;

  beforeEach(() => {
    dataSource = {
      // Runs the unit of work against the fake manager, mimicking commit-or-rethrow semantics.
      transaction: jest.fn((...args: unknown[]) => {
        const run = args[args.length - 1] as (m: EntityManager) => Promise<unknown>;
        return run(manager);
      }),
    };
    lockers = {
      lockSmallestAvailable: jest.fn(),
      lockById: jest.fn(),
      setStatus: jest.fn(),
      findByIdWithCurrentPackage: jest.fn(),
    };
    packages = {
      insertStored: jest.fn(),
      findStoredByLocker: jest.fn(),
      markRetrieved: jest.fn(),
      recordFailedAttempt: jest.fn(),
      findAllStored: jest.fn(),
      sumCollected: jest.fn(),
    };
    codes = { generate: jest.fn().mockReturnValue('123456') };
    hasher = new PickupCodeHasher('unit-test-secret-unit-test-secret-0000');
    pricing = new TieredPricingStrategy({
      ratePerDay: 10,
      tiers: [
        { days: 5, multiplier: 1 },
        { days: 5, multiplier: 2 },
        { days: null, multiplier: 3 },
      ],
      freeDays: 0,
      currency: 'UNITS',
    });
    const clock: Clock = { now: () => NOW };
    events = new LockerEventsService();
    publish = jest.spyOn(events, 'publish');
    usersService = {
      requireActiveCustomer: jest.fn().mockResolvedValue(CUSTOMER),
      labelsFor: jest.fn().mockResolvedValue(new Map([[CUSTOMER.id, CUSTOMER]])),
    };
    mailer = { send: jest.fn().mockResolvedValue(undefined) };
    billing = { billCollection: jest.fn().mockResolvedValue(undefined) };

    service = new PackagesService(
      dataSource as unknown as DataSource,
      lockers as unknown as LockersRepository,
      packages as unknown as PackagesRepository,
      codes,
      hasher,
      CIPHER,
      pricing,
      new PickupLockoutPolicy(3, 15 * 60_000),
      clock,
      events,
      usersService as unknown as UsersService,
      mailer,
      billing as unknown as BillingService,
    );
  });

  describe('store', () => {
    it('assigns the locked locker, marks it occupied and returns the plain code once', async () => {
      lockers.lockSmallestAvailable.mockResolvedValue(locker());
      packages.insertStored.mockImplementation((data) =>
        Promise.resolve(storedPackage(hasher, '123456', { ...data })),
      );

      const result = await service.store({ size: LockerSize.SMALL, customerId: CUSTOMER.id });

      expect(lockers.lockSmallestAvailable).toHaveBeenCalledWith(LockerSize.SMALL, manager);
      expect(packages.insertStored).toHaveBeenCalledWith(
        expect.objectContaining({
          lockerId: 'locker-1',
          size: LockerSize.SMALL,
          customerUserId: CUSTOMER.id,
          pickupCodeHash: hasher.hash('123456'),
          pickupCodeEncrypted: expect.stringMatching(/^v1\./),
          storedAt: NOW,
        }),
        manager,
      );
      expect(lockers.setStatus).toHaveBeenCalledWith('locker-1', LockerStatus.OCCUPIED, manager);
      expect(result).toMatchObject({
        lockerId: 'locker-1',
        lockerLabel: 'A-01',
        lockerSize: LockerSize.MEDIUM,
        packageSize: LockerSize.SMALL,
        pickupCode: '123456',
        storedAt: NOW,
      });
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'package.stored',
          lockerId: 'locker-1',
          status: LockerStatus.OCCUPIED,
        }),
      );
      expect(JSON.stringify(publish.mock.calls)).not.toContain('123456');
      expect(result.customer).toEqual({ id: CUSTOMER.id, label: 'Alice' });
      expect(result.notified).toBe(true);
      expect(mailer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          text: expect.stringContaining('123456'),
        }),
      );
    });

    it('still succeeds when the notification email fails, and says so', async () => {
      lockers.lockSmallestAvailable.mockResolvedValue(locker());
      packages.insertStored.mockImplementation((data) =>
        Promise.resolve(storedPackage(hasher, '123456', { ...data })),
      );
      mailer.send.mockRejectedValue(new Error('smtp down'));

      const result = await service.store({ size: LockerSize.SMALL, customerId: CUSTOMER.id });
      expect(result.pickupCode).toBe('123456');
      expect(result.notified).toBe(false);
    });

    it('refuses to store for anyone who is not an active customer', async () => {
      usersService.requireActiveCustomer.mockRejectedValue(new Error('CUSTOMER_NOT_FOUND'));
      await expect(service.store({ size: LockerSize.SMALL, customerId: 'nobody' })).rejects.toThrow(
        'CUSTOMER_NOT_FOUND',
      );
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('fails with NO_SUITABLE_LOCKER when nothing fits, without writing anything', async () => {
      lockers.lockSmallestAvailable.mockResolvedValue(null);

      await expect(
        service.store({ size: LockerSize.LARGE, customerId: CUSTOMER.id }),
      ).rejects.toBeInstanceOf(NoSuitableLockerError);
      expect(packages.insertStored).not.toHaveBeenCalled();
      expect(lockers.setStatus).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('retries with a fresh code when the active-code unique index rejects the first one', async () => {
      lockers.lockSmallestAvailable.mockResolvedValue(locker());
      codes.generate.mockReturnValueOnce('111111').mockReturnValueOnce('222222');
      packages.insertStored
        .mockRejectedValueOnce(uniqueViolation(DB.ACTIVE_PICKUP_CODE_UNIQUE))
        .mockImplementationOnce((data) =>
          Promise.resolve(storedPackage(hasher, '222222', { ...data })),
        );

      const result = await service.store({ size: LockerSize.SMALL, customerId: CUSTOMER.id });

      expect(result.pickupCode).toBe('222222');
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
    });

    it('gives up after the configured number of code collisions', async () => {
      lockers.lockSmallestAvailable.mockResolvedValue(locker());
      packages.insertStored.mockRejectedValue(uniqueViolation(DB.ACTIVE_PICKUP_CODE_UNIQUE));

      await expect(
        service.store({ size: LockerSize.SMALL, customerId: CUSTOMER.id }),
      ).rejects.toBeInstanceOf(PickupCodeGenerationError);
      expect(dataSource.transaction).toHaveBeenCalledTimes(MAX_PICKUP_CODE_ATTEMPTS);
    });

    it('does not retry on other unique violations (e.g. one-package-per-locker)', async () => {
      lockers.lockSmallestAvailable.mockResolvedValue(locker());
      packages.insertStored.mockRejectedValue(uniqueViolation(DB.ONE_STORED_PACKAGE_PER_LOCKER));

      await expect(
        service.store({ size: LockerSize.SMALL, customerId: CUSTOMER.id }),
      ).rejects.toBeInstanceOf(QueryFailedError);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('retrieve', () => {
    it('releases the locker and returns the tiered charge for the time stored', async () => {
      const storedAt = new Date(NOW.getTime() - 7 * DAY);
      lockers.lockById.mockResolvedValue(locker({ status: LockerStatus.OCCUPIED }));
      packages.findStoredByLocker.mockResolvedValue(storedPackage(hasher, '123456', { storedAt }));

      const result = await service.retrieve(
        { lockerId: 'locker-1', pickupCode: '123456' },
        asCustomer,
      );

      expect(lockers.lockById).toHaveBeenCalledWith('locker-1', manager);
      expect(packages.markRetrieved).toHaveBeenCalledWith(
        'pkg-1',
        { retrievedAt: NOW, storageCharge: 90, chargedDays: 7 },
        manager,
      );
      expect(lockers.setStatus).toHaveBeenCalledWith('locker-1', LockerStatus.AVAILABLE, manager);
      expect(result).toMatchObject({
        packageId: 'pkg-1',
        lockerId: 'locker-1',
        lockerOpened: true,
        storedAt,
        retrievedAt: NOW,
      });
      expect(result.storageCharge.amount).toBe(90);
      expect(result.storageCharge.breakdown).toHaveLength(2);
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'package.retrieved',
          lockerId: 'locker-1',
          status: LockerStatus.AVAILABLE,
        }),
      );
    });

    it("refuses a customer collecting someone else's package, without touching it", async () => {
      lockers.lockById.mockResolvedValue(locker({ status: LockerStatus.OCCUPIED }));
      packages.findStoredByLocker.mockResolvedValue(storedPackage(hasher, '123456'));

      await expect(
        service.retrieve(
          { lockerId: 'locker-1', pickupCode: '123456' },
          { id: 'someone-else', role: UserRole.CUSTOMER },
        ),
      ).rejects.toBeInstanceOf(NotYourPackageError);
      expect(packages.markRetrieved).not.toHaveBeenCalled();
      expect(packages.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it('lets an admin collect on behalf of any customer', async () => {
      lockers.lockById.mockResolvedValue(locker({ status: LockerStatus.OCCUPIED }));
      packages.findStoredByLocker.mockResolvedValue(storedPackage(hasher, '123456'));

      const result = await service.retrieve(
        { lockerId: 'locker-1', pickupCode: '123456' },
        asAdmin,
      );
      expect(result.lockerOpened).toBe(true);
    });

    it('rejects an unknown locker', async () => {
      lockers.lockById.mockResolvedValue(null);
      await expect(
        service.retrieve({ lockerId: 'nope', pickupCode: '123456' }, asCustomer),
      ).rejects.toBeInstanceOf(LockerNotFoundError);
    });

    it('rejects a locker with nothing inside', async () => {
      lockers.lockById.mockResolvedValue(locker());
      packages.findStoredByLocker.mockResolvedValue(null);
      await expect(
        service.retrieve({ lockerId: 'locker-1', pickupCode: '123456' }, asCustomer),
      ).rejects.toBeInstanceOf(LockerEmptyError);
      expect(lockers.setStatus).not.toHaveBeenCalled();
    });

    it('rejects a wrong code and leaves the package in place', async () => {
      lockers.lockById.mockResolvedValue(locker({ status: LockerStatus.OCCUPIED }));
      packages.findStoredByLocker.mockResolvedValue(storedPackage(hasher, '123456'));

      await expect(
        service.retrieve({ lockerId: 'locker-1', pickupCode: '654321' }, asCustomer),
      ).rejects.toBeInstanceOf(InvalidPickupCodeError);
      expect(packages.markRetrieved).not.toHaveBeenCalled();
      expect(lockers.setStatus).not.toHaveBeenCalled();
      expect(packages.recordFailedAttempt).toHaveBeenCalledWith(
        'pkg-1',
        { failedPickupAttempts: 1, pickupLockedUntil: null },
        manager,
      );
    });

    it('locks the package out once the failed-attempt limit is reached', async () => {
      lockers.lockById.mockResolvedValue(locker({ status: LockerStatus.OCCUPIED }));
      packages.findStoredByLocker.mockResolvedValue(
        storedPackage(hasher, '123456', { failedPickupAttempts: 2 }),
      );

      await expect(
        service.retrieve({ lockerId: 'locker-1', pickupCode: '654321' }, asCustomer),
      ).rejects.toBeInstanceOf(PickupLockedError);
      expect(packages.recordFailedAttempt).toHaveBeenCalledWith(
        'pkg-1',
        { failedPickupAttempts: 3, pickupLockedUntil: new Date(NOW.getTime() + 15 * 60_000) },
        manager,
      );
    });

    it('refuses even the right code while the lockout is active', async () => {
      lockers.lockById.mockResolvedValue(locker({ status: LockerStatus.OCCUPIED }));
      packages.findStoredByLocker.mockResolvedValue(
        storedPackage(hasher, '123456', {
          failedPickupAttempts: 3,
          pickupLockedUntil: new Date(NOW.getTime() + 60_000),
        }),
      );

      await expect(
        service.retrieve({ lockerId: 'locker-1', pickupCode: '123456' }, asCustomer),
      ).rejects.toBeInstanceOf(PickupLockedError);
      expect(packages.markRetrieved).not.toHaveBeenCalled();
      expect(packages.recordFailedAttempt).not.toHaveBeenCalled();
    });

    it('accepts the right code once the lockout has expired, and restarts the count on a wrong one', async () => {
      lockers.lockById.mockResolvedValue(locker({ status: LockerStatus.OCCUPIED }));
      const expired = storedPackage(hasher, '123456', {
        failedPickupAttempts: 3,
        pickupLockedUntil: new Date(NOW.getTime() - 1),
      });
      packages.findStoredByLocker.mockResolvedValue(expired);

      await expect(
        service.retrieve({ lockerId: 'locker-1', pickupCode: '654321' }, asCustomer),
      ).rejects.toBeInstanceOf(InvalidPickupCodeError);
      expect(packages.recordFailedAttempt).toHaveBeenCalledWith(
        'pkg-1',
        { failedPickupAttempts: 1, pickupLockedUntil: null },
        manager,
      );

      packages.recordFailedAttempt.mockClear();
      const result = await service.retrieve(
        { lockerId: 'locker-1', pickupCode: '123456' },
        asCustomer,
      );
      expect(result.lockerOpened).toBe(true);
      expect(packages.markRetrieved).toHaveBeenCalled();
    });
  });

  describe('charges owed', () => {
    it('quotes a waiting package as at now, and a collected one as at its retrieval', () => {
      const waiting = storedPackage(hasher, '123456', {
        storedAt: new Date(NOW.getTime() - 3 * DAY),
      });
      expect(service.chargeSoFar(waiting)).toMatchObject({ totalDays: 3, amount: 30 });

      const collected = storedPackage(hasher, '123456', {
        status: PackageStatus.RETRIEVED,
        storedAt: new Date(NOW.getTime() - 9 * DAY),
        retrievedAt: new Date(NOW.getTime() - 2 * DAY),
        storageCharge: 90,
        chargedDays: 7,
      });
      // 7 days at the time it was collected, not 9 days to now.
      expect(service.chargeSoFar(collected)).toMatchObject({ totalDays: 7, amount: 90 });
    });

    it('totals what is owed on waiting packages and what has been charged', async () => {
      packages.findAllStored.mockResolvedValue([
        storedPackage(hasher, '111111', { storedAt: new Date(NOW.getTime() - 1 * DAY) }),
        storedPackage(hasher, '222222', { storedAt: new Date(NOW.getTime() - 6 * DAY) }),
      ]);
      packages.sumCollected.mockResolvedValue({ packages: 4, amount: 123.456 });

      await expect(service.chargesSummary()).resolves.toEqual({
        currency: 'UNITS',
        outstanding: { packages: 2, amount: 80 }, // 1 day = 10, plus 6 days = 5x10 + 1x20 = 70
        collected: { packages: 4, amount: 123.46 },
      });
    });

    it('reports zeroes for an empty station', async () => {
      packages.findAllStored.mockResolvedValue([]);
      packages.sumCollected.mockResolvedValue({ packages: 0, amount: 0 });
      await expect(service.chargesSummary()).resolves.toMatchObject({
        outstanding: { packages: 0, amount: 0 },
        collected: { packages: 0, amount: 0 },
      });
    });
  });

  describe('revealPickupCode (admin assistance)', () => {
    it('returns the waiting package code and who it is for, and logs the reveal', async () => {
      lockers.findByIdWithCurrentPackage.mockResolvedValue(
        locker({ status: LockerStatus.OCCUPIED }),
      );
      packages.findStoredByLocker.mockResolvedValue(storedPackage(hasher, '123456'));

      const result = await service.revealPickupCode('locker-1', asAdmin);
      expect(result).toEqual({ lockerLabel: 'A-01', pickupCode: '123456', customerLabel: 'Alice' });
    });

    it('reports an empty locker and an unknown locker', async () => {
      lockers.findByIdWithCurrentPackage.mockResolvedValue(null);
      await expect(service.revealPickupCode('nope', asAdmin)).rejects.toBeInstanceOf(
        LockerNotFoundError,
      );

      lockers.findByIdWithCurrentPackage.mockResolvedValue(locker());
      packages.findStoredByLocker.mockResolvedValue(null);
      await expect(service.revealPickupCode('locker-1', asAdmin)).rejects.toBeInstanceOf(
        LockerEmptyError,
      );
    });

    it('cannot recover codes of packages stored before encryption existed', async () => {
      lockers.findByIdWithCurrentPackage.mockResolvedValue(
        locker({ status: LockerStatus.OCCUPIED }),
      );
      packages.findStoredByLocker.mockResolvedValue(
        storedPackage(hasher, '123456', { pickupCodeEncrypted: null }),
      );
      await expect(service.revealPickupCode('locker-1', asAdmin)).rejects.toBeInstanceOf(
        PickupCodeUnavailableError,
      );
    });
  });
});
