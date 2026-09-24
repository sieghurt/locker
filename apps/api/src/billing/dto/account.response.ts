import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CustomerTransaction } from '../customer-transaction.entity';
import { TransactionType } from '../transaction-type';

export class TransactionResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: TransactionType }) type!: TransactionType;
  @ApiProperty({ example: 90, description: 'Signed: positive is owed, negative was paid' })
  amount!: number;
  @ApiProperty({ example: 'UNITS' }) currency!: string;
  @ApiProperty({ example: 'Storage for 7 days in locker S-01' }) description!: string;
  @ApiPropertyOptional({ nullable: true }) packageId!: string | null;
  @ApiProperty() occurredAt!: Date;

  static from(t: CustomerTransaction): TransactionResponse {
    return {
      id: t.id,
      type: t.type,
      amount: t.amount,
      currency: t.currency,
      description: t.description,
      packageId: t.packageId,
      occurredAt: t.occurredAt,
    };
  }
}

export class AccountResponse {
  @ApiProperty() customerId!: string;
  @ApiProperty({ example: 'Alice', description: 'Display name or masked email' })
  customerLabel!: string;
  @ApiProperty({ example: 'UNITS' }) currency!: string;
  @ApiProperty({ example: 90, description: 'What the customer owes now: charged minus paid' })
  balance!: number;
  @ApiProperty({ example: 130 }) charged!: number;
  @ApiProperty({ example: 40 }) paid!: number;
  @ApiProperty({ example: 6, description: 'Rows in the ledger' }) transactions!: number;
}

export class AccountListResponse {
  @ApiProperty({ type: [AccountResponse] }) items!: AccountResponse[];
  @ApiProperty() total!: number;
  @ApiProperty({ example: 90, description: 'Sum of every customer balance' }) totalBalance!: number;
}

export class StatementResponse {
  @ApiProperty({ type: AccountResponse }) account!: AccountResponse;
  @ApiProperty({ type: [TransactionResponse] }) items!: TransactionResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
}
