import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';

import { CustomerTransaction } from './customer-transaction.entity';
import { TransactionType } from './transaction-type';

export interface NewTransaction {
  customerUserId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  description: string;
  packageId?: string | null;
  recordedByUserId?: string | null;
  occurredAt: Date;
}

/** Station-wide totals, across every customer. */
export interface LedgerTotals extends AccountTotals {
  /** Currencies present in the ledger. More than one means the aggregate would be meaningless. */
  currencies: string[];
}

/** Totals for one customer, straight from the ledger. */
export interface AccountTotals {
  balance: number;
  charged: number;
  paid: number;
  transactions: number;
}

const EMPTY: AccountTotals = { balance: 0, charged: 0, paid: 0, transactions: 0 };

const round2 = (value: number): number => Math.round(value * 100) / 100;

@Injectable()
export class CustomerTransactionsRepository {
  constructor(
    @InjectRepository(CustomerTransaction)
    private readonly transactions: Repository<CustomerTransaction>,
  ) {}

  /** `manager` joins the caller's transaction, so billing a collection commits with it or not at all. */
  async insert(data: NewTransaction, manager?: EntityManager): Promise<CustomerTransaction> {
    const repo = manager ? manager.getRepository(CustomerTransaction) : this.transactions;
    return repo.save(
      repo.create({
        ...data,
        packageId: data.packageId ?? null,
        recordedByUserId: data.recordedByUserId ?? null,
      }),
    );
  }

  async findByCustomer(
    customerUserId: string,
    page: { limit: number; offset: number },
  ): Promise<{ items: CustomerTransaction[]; total: number }> {
    const [items, total] = await this.transactions.findAndCount({
      where: { customerUserId },
      order: { occurredAt: 'DESC', createdAt: 'DESC' },
      skip: page.offset,
      take: page.limit,
    });
    return { items, total };
  }

  /** The whole ledger in one row, with the currencies it is denominated in. */
  async totalsForAll(): Promise<LedgerTotals> {
    const rows = await this.transactions
      .createQueryBuilder('t')
      .select('t.currency', 'currency')
      .addSelect('COALESCE(SUM(t.amount), 0)::float', 'balance')
      .addSelect(
        `COALESCE(SUM(CASE WHEN t.type = 'CHARGE' THEN t.amount ELSE 0 END), 0)::float`,
        'charged',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t.type = 'PAYMENT' THEN -t.amount ELSE 0 END), 0)::float`,
        'paid',
      )
      .addSelect('COUNT(*)::int', 'transactions')
      .groupBy('t.currency')
      .getRawMany<AccountTotals & { currency: string }>();

    return {
      balance: round2(rows.reduce((sum, r) => sum + r.balance, 0)),
      charged: round2(rows.reduce((sum, r) => sum + r.charged, 0)),
      paid: round2(rows.reduce((sum, r) => sum + r.paid, 0)),
      transactions: rows.reduce((sum, r) => sum + r.transactions, 0),
      currencies: rows.map((r) => r.currency),
    };
  }

  async totalsFor(customerUserId: string): Promise<AccountTotals> {
    const rows = await this.totalsByCustomer([customerUserId]);
    return rows.get(customerUserId) ?? EMPTY;
  }

  /** Totals for many customers in one query; customers with no rows are simply absent. */
  async totalsByCustomer(customerUserIds?: string[]): Promise<Map<string, AccountTotals>> {
    if (customerUserIds && customerUserIds.length === 0) return new Map();

    const qb = this.transactions
      .createQueryBuilder('t')
      .select('t.customer_user_id', 'customerUserId')
      .addSelect('COALESCE(SUM(t.amount), 0)::float', 'balance')
      .addSelect(
        `COALESCE(SUM(CASE WHEN t.type = 'CHARGE' THEN t.amount ELSE 0 END), 0)::float`,
        'charged',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN t.type = 'PAYMENT' THEN -t.amount ELSE 0 END), 0)::float`,
        'paid',
      )
      .addSelect('COUNT(*)::int', 'transactions')
      .groupBy('t.customer_user_id');

    if (customerUserIds) qb.where('t.customer_user_id IN (:...ids)', { ids: customerUserIds });

    const rows = await qb.getRawMany<AccountTotals & { customerUserId: string }>();
    return new Map(
      rows.map((row) => [
        row.customerUserId,
        {
          balance: round2(row.balance),
          charged: round2(row.charged),
          paid: round2(row.paid),
          transactions: row.transactions,
        },
      ]),
    );
  }
}
