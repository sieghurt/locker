import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';

import { Clock } from '../common/clock';
import { UserNotFoundError } from '../common/errors/domain.errors';
import { EnvironmentVariables } from '../config/environment';
import { publicLabel, User } from '../users/user.entity';
import { UserRole } from '../users/user-role';
import { UsersService } from '../users/users.service';
import { CustomerTransaction } from './customer-transaction.entity';
import { AccountTotals, CustomerTransactionsRepository } from './customer-transactions.repository';
import { TransactionType } from './transaction-type';

export interface Account extends AccountTotals {
  customerId: string;
  customerLabel: string;
  currency: string;
}

export interface BillCollectionInput {
  customerUserId: string;
  packageId: string;
  amount: number;
  currency: string;
  description: string;
  occurredAt: Date;
}

/**
 * The customer ledger: what each customer has been charged, what they have paid, and what they owe.
 * Charges are written by the packages module when a collection is billed, inside that transaction;
 * payments are recorded by an admin. Nothing is ever updated or deleted, so the history is the truth
 * and the balance is derived from it.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly transactions: CustomerTransactionsRepository,
    private readonly usersService: UsersService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly clock: Clock,
  ) {}

  get currency(): string {
    return this.config.get('STORAGE_CURRENCY', { infer: true });
  }

  /** Called from the retrieval transaction: bills the storage this collection cost. */
  async billCollection(input: BillCollectionInput, manager: EntityManager): Promise<void> {
    if (input.amount <= 0) return; // nothing to bill, so nothing goes in the ledger
    await this.transactions.insert(
      {
        customerUserId: input.customerUserId,
        type: TransactionType.CHARGE,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        packageId: input.packageId,
        occurredAt: input.occurredAt,
      },
      manager,
    );
  }

  async recordPayment(
    customerId: string,
    input: { amount: number; note?: string },
    actor: { id: string },
  ): Promise<CustomerTransaction> {
    const customer = await this.requireCustomer(customerId);
    const occurredAt = this.clock.now();
    const transaction = await this.transactions.insert({
      customerUserId: customer.id,
      type: TransactionType.PAYMENT,
      // Stored negative: the balance is the sum of the ledger.
      amount: -Math.abs(input.amount),
      currency: this.currency,
      description: input.note?.trim() || 'Payment received',
      recordedByUserId: actor.id,
      occurredAt,
    });
    this.logger.log(
      `Admin ${actor.id} recorded a payment of ${input.amount} for customer ${customer.id}`,
    );
    return transaction;
  }

  /**
   * The correction path for an append-only ledger: a mistake is fixed by adding a row, never by
   * editing or deleting one, so the history still explains the balance.
   */
  async recordAdjustment(
    customerId: string,
    input: { amount: number; reason: string },
    actor: { id: string },
  ): Promise<CustomerTransaction> {
    const customer = await this.requireCustomer(customerId);
    const transaction = await this.transactions.insert({
      customerUserId: customer.id,
      type: TransactionType.ADJUSTMENT,
      amount: input.amount,
      currency: this.currency,
      description: input.reason.trim(),
      recordedByUserId: actor.id,
      occurredAt: this.clock.now(),
    });
    this.logger.warn(
      `Admin ${actor.id} adjusted customer ${customer.id} by ${input.amount}: ${input.reason.trim()}`,
    );
    return transaction;
  }

  async accountFor(customerId: string): Promise<Account> {
    const customer = await this.requireCustomer(customerId);
    const totals = await this.transactions.totalsFor(customer.id);
    return {
      customerId: customer.id,
      customerLabel: publicLabel(customer),
      currency: this.currency,
      ...totals,
    };
  }

  async statementFor(
    customerId: string,
    page: { limit: number; offset: number },
  ): Promise<{ account: Account; items: CustomerTransaction[]; total: number }> {
    const account = await this.accountFor(customerId);
    const { items, total } = await this.transactions.findByCustomer(account.customerId, page);
    return { account, items, total };
  }

  /** Every customer with their balance, including those who have never been charged. */
  async listAccounts(page: {
    limit: number;
    offset: number;
  }): Promise<{ items: Account[]; total: number; totalBalance: number }> {
    const { items: customers, total } = await this.usersService.list({
      role: UserRole.CUSTOMER,
      limit: page.limit,
      offset: page.offset,
    });
    const totals = await this.transactions.totalsByCustomer(customers.map((c) => c.id));
    const items = customers.map((customer) => ({
      customerId: customer.id,
      customerLabel: publicLabel(customer),
      currency: this.currency,
      ...(totals.get(customer.id) ?? { balance: 0, charged: 0, paid: 0, transactions: 0 }),
    }));
    // Across every customer, not just this page: an operator reads this as the station's receivable.
    const ledger = await this.transactions.totalsForAll();
    if (ledger.currencies.length > 1) {
      this.logger.error(
        `The ledger holds more than one currency (${ledger.currencies.join(', ')}); totals are not meaningful. ` +
          'Changing STORAGE_CURRENCY needs a data migration.',
      );
    }
    return { items, total, totalBalance: ledger.balance };
  }

  /** Any customer account, active or not: an admin still needs to settle a closed one. */
  private async requireCustomer(customerId: string): Promise<User> {
    const user = await this.usersService.getById(customerId);
    if (user.role !== UserRole.CUSTOMER) throw new UserNotFoundError(customerId);
    return user;
  }
}
