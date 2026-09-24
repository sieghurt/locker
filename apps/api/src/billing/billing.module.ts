import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UsersModule } from '../users/users.module';

import { AccountsController } from './accounts.controller';
import { BillingService } from './billing.service';
import { CustomerTransaction } from './customer-transaction.entity';
import { CustomerTransactionsRepository } from './customer-transactions.repository';

/**
 * Owns the customer ledger. Depends on users only: the packages module calls in to bill a collection,
 * never the other way round, which keeps the dependency one-directional.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerTransaction]), UsersModule],
  controllers: [AccountsController],
  providers: [CustomerTransactionsRepository, BillingService],
  exports: [BillingService],
})
export class BillingModule {}
