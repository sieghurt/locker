import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';

import { UserNotFoundError } from '../common/errors/domain.errors';
import { EnvironmentVariables } from '../config/environment';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role';
import { UsersService } from '../users/users.service';
import { BillingService } from './billing.service';
import { CustomerTransactionsRepository } from './customer-transactions.repository';
import { TransactionType } from './transaction-type';

const NOW = new Date('2026-03-10T12:00:00.000Z');

const user = (overrides: Partial<User> = {}): User => ({
  id: 'cust-1',
  email: 'alice@example.com',
  role: UserRole.CUSTOMER,
  displayName: 'Alice',
  active: true,
  lastLoginAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('BillingService', () => {
  let transactions: jest.Mocked<
    Pick<
      CustomerTransactionsRepository,
      'insert' | 'findByCustomer' | 'totalsFor' | 'totalsByCustomer' | 'totalsForAll'
    >
  >;
  let usersService: { getById: jest.Mock; list: jest.Mock };
  let service: BillingService;

  beforeEach(() => {
    transactions = {
      insert: jest.fn().mockImplementation((data: unknown) => Promise.resolve(data)),
      findByCustomer: jest.fn(),
      totalsFor: jest.fn().mockResolvedValue({ balance: 0, charged: 0, paid: 0, transactions: 0 }),
      totalsByCustomer: jest.fn().mockResolvedValue(new Map()),
      totalsForAll: jest
        .fn()
        .mockResolvedValue({ balance: 0, charged: 0, paid: 0, transactions: 0, currencies: [] }),
    };
    usersService = { getById: jest.fn().mockResolvedValue(user()), list: jest.fn() };
    const config = { get: () => 'UNITS' } as unknown as ConfigService<EnvironmentVariables, true>;
    service = new BillingService(
      transactions as unknown as CustomerTransactionsRepository,
      usersService as unknown as UsersService,
      config,
      { now: () => NOW },
    );
  });

  describe('billCollection', () => {
    const manager = {} as EntityManager;

    it('writes a positive CHARGE joined to the caller transaction', async () => {
      await service.billCollection(
        {
          customerUserId: 'cust-1',
          packageId: 'pkg-1',
          amount: 90,
          currency: 'UNITS',
          description: 'Storage for 7 day(s) in locker S-01',
          occurredAt: NOW,
        },
        manager,
      );

      expect(transactions.insert).toHaveBeenCalledWith(
        expect.objectContaining({ type: TransactionType.CHARGE, amount: 90, packageId: 'pkg-1' }),
        manager,
      );
    });

    it('writes nothing when the collection cost nothing', async () => {
      await service.billCollection(
        {
          customerUserId: 'cust-1',
          packageId: 'pkg-1',
          amount: 0,
          currency: 'UNITS',
          description: 'free',
          occurredAt: NOW,
        },
        manager,
      );
      expect(transactions.insert).not.toHaveBeenCalled();
    });
  });

  describe('recordPayment', () => {
    it('stores a payment as a negative amount, attributed to the admin who took it', async () => {
      await service.recordPayment(
        'cust-1',
        { amount: 40, note: '  Cash at the kiosk  ' },
        { id: 'admin-1' },
      );

      expect(transactions.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransactionType.PAYMENT,
          amount: -40,
          description: 'Cash at the kiosk',
          recordedByUserId: 'admin-1',
          occurredAt: NOW,
        }),
      );
    });

    it('never stores a positive payment, whatever sign it is given', async () => {
      await service.recordPayment('cust-1', { amount: -40 }, { id: 'admin-1' });
      expect(transactions.insert).toHaveBeenCalledWith(
        expect.objectContaining({ amount: -40, description: 'Payment received' }),
      );
    });

    it('refuses an account that is not a customer', async () => {
      usersService.getById.mockResolvedValue(user({ role: UserRole.AGENT }));
      await expect(
        service.recordPayment('agent-1', { amount: 10 }, { id: 'admin-1' }),
      ).rejects.toBeInstanceOf(UserNotFoundError);
      expect(transactions.insert).not.toHaveBeenCalled();
    });
  });

  describe('accounts', () => {
    it('reports a customer balance with their masked label', async () => {
      transactions.totalsFor.mockResolvedValue({
        balance: 50,
        charged: 90,
        paid: 40,
        transactions: 3,
      });
      await expect(service.accountFor('cust-1')).resolves.toEqual({
        customerId: 'cust-1',
        customerLabel: 'Alice',
        currency: 'UNITS',
        balance: 50,
        charged: 90,
        paid: 40,
        transactions: 3,
      });
    });

    it('lists every customer, including those who have never been charged, and totals the balances', async () => {
      usersService.list.mockResolvedValue({
        items: [user(), user({ id: 'cust-2', displayName: null, email: 'bob@example.com' })],
        total: 2,
      });
      transactions.totalsByCustomer.mockResolvedValue(
        new Map([['cust-1', { balance: 50, charged: 90, paid: 40, transactions: 3 }]]),
      );

      // The page shows two customers owing 50 between them; the station as a whole owes far more.
      transactions.totalsForAll.mockResolvedValue({
        balance: 512.5,
        charged: 800,
        paid: 287.5,
        transactions: 40,
        currencies: ['UNITS'],
      });

      const result = await service.listAccounts({ limit: 50, offset: 0 });
      expect(result.total).toBe(2);
      // Not the sum of this page: an operator reads this as everything the station is owed.
      expect(result.totalBalance).toBe(512.5);
      expect(result.items[1]).toMatchObject({
        customerId: 'cust-2',
        customerLabel: 'bo***@example.com',
        balance: 0,
        transactions: 0,
      });
    });
  });

  describe('recordAdjustment', () => {
    it('writes a signed correction with its reason, attributed to the admin', async () => {
      await service.recordAdjustment(
        'cust-1',
        { amount: -40, reason: '  Paid twice on 24 Sep  ' },
        { id: 'admin-1' },
      );

      expect(transactions.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: TransactionType.ADJUSTMENT,
          amount: -40,
          description: 'Paid twice on 24 Sep',
          recordedByUserId: 'admin-1',
        }),
      );
    });

    it('can correct in either direction and refuses a non-customer', async () => {
      await service.recordAdjustment(
        'cust-1',
        { amount: 15, reason: 'Undercharged' },
        { id: 'admin-1' },
      );
      expect(transactions.insert).toHaveBeenCalledWith(expect.objectContaining({ amount: 15 }));

      usersService.getById.mockResolvedValue(user({ role: UserRole.AGENT }));
      await expect(
        service.recordAdjustment('agent-1', { amount: 1, reason: 'x' }, { id: 'admin-1' }),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });
});
