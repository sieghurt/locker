import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { SessionUser } from '../auth/session-token.service';
import { UserRole } from '../users/user-role';
import { BillingService } from './billing.service';
import {
  AccountListResponse,
  AccountResponse,
  StatementResponse,
  TransactionResponse,
} from './dto/account.response';
import { ListTransactionsQuery } from './dto/list-transactions.query';
import { RecordAdjustmentDto, RecordPaymentDto } from './dto/record-payment.dto';

@ApiTags('accounts')
@ApiCookieAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly billing: BillingService) {}

  @Get('me')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Customer: my balance (what I have been charged, paid, and still owe)' })
  @ApiResponse({ status: 200, type: AccountResponse })
  async myAccount(@CurrentUser() actor: SessionUser): Promise<AccountResponse> {
    return this.billing.accountFor(actor.id);
  }

  @Get('me/transactions')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({ summary: 'Customer: my transaction history, newest first' })
  @ApiResponse({ status: 200, type: StatementResponse })
  async myTransactions(
    @CurrentUser() actor: SessionUser,
    @Query() query: ListTransactionsQuery,
  ): Promise<StatementResponse> {
    const { account, items, total } = await this.billing.statementFor(actor.id, query);
    return {
      account,
      items: items.map((t) => TransactionResponse.from(t)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: every customer with their balance' })
  @ApiResponse({ status: 200, type: AccountListResponse })
  async list(@Query() query: ListTransactionsQuery): Promise<AccountListResponse> {
    return this.billing.listAccounts(query);
  }

  @Get(':customerId')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Admin: one customer's balance" })
  @ApiResponse({ status: 200, type: AccountResponse })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  async account(@Param('customerId', ParseUUIDPipe) customerId: string): Promise<AccountResponse> {
    return this.billing.accountFor(customerId);
  }

  @Get(':customerId/transactions')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: "Admin: one customer's transaction history" })
  @ApiResponse({ status: 200, type: StatementResponse })
  async transactions(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: ListTransactionsQuery,
  ): Promise<StatementResponse> {
    const { account, items, total } = await this.billing.statementFor(customerId, query);
    return {
      account,
      items: items.map((t) => TransactionResponse.from(t)),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Post(':customerId/adjustments')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Admin: correct a balance by adding a signed adjustment row',
    description:
      'The ledger is append-only, so a mistake (a payment recorded twice, a charge that should be waived) ' +
      'is fixed by adding a correction with a reason, never by editing history.',
  })
  @ApiResponse({ status: 201, type: TransactionResponse })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  async recordAdjustment(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() body: RecordAdjustmentDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<TransactionResponse> {
    return TransactionResponse.from(await this.billing.recordAdjustment(customerId, body, actor));
  }

  @Post(':customerId/payments')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Admin: record money received from a customer' })
  @ApiResponse({ status: 201, type: TransactionResponse })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  async recordPayment(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() body: RecordPaymentDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<TransactionResponse> {
    return TransactionResponse.from(await this.billing.recordPayment(customerId, body, actor));
  }
}
