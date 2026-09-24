import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { StorageCharge } from '../../pricing/storage-pricing.strategy';
import { Locker } from '../locker.entity';
import { LockerSize } from '../locker-size';
import { LockerStatus } from '../locker-status';

export class LockerCurrentPackageResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: LockerSize }) size!: LockerSize;
  @ApiPropertyOptional({
    example: 'Alice',
    description: 'Customer display name or masked email. Sent to staff (AGENT, ADMIN) only.',
  })
  customerLabel?: string;
  @ApiProperty() storedAt!: Date;
  @ApiPropertyOptional({
    example: { amount: 20, chargedDays: 2, currency: 'UNITS' },
    description: 'What this package owes so far. Present for ADMIN callers only.',
  })
  accruedCharge?: { amount: number; chargedDays: number; currency: string };
}

export class LockerResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'A-01' }) label!: string;
  @ApiProperty({ enum: LockerSize }) size!: LockerSize;
  @ApiProperty({ enum: LockerStatus }) status!: LockerStatus;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional({ type: LockerCurrentPackageResponse, nullable: true })
  currentPackage!: LockerCurrentPackageResponse | null;

  /**
   * Pickup codes are never part of a locker view; only the store response reveals one, once.
   * `customerLabel` is omitted for customers, so the board tells them a locker is occupied without
   * saying whose package is inside.
   */
  static from(locker: Locker, customerLabel?: string, accrued?: StorageCharge): LockerResponse {
    const pkg = locker.currentPackage ?? null;
    return {
      id: locker.id,
      label: locker.label,
      size: locker.size,
      status: locker.status,
      createdAt: locker.createdAt,
      currentPackage: pkg
        ? {
            id: pkg.id,
            size: pkg.size,
            customerLabel: customerLabel,
            storedAt: pkg.storedAt,
            ...(accrued
              ? {
                  accruedCharge: {
                    amount: accrued.amount,
                    chargedDays: accrued.chargedDays,
                    currency: accrued.currency,
                  },
                }
              : {}),
          }
        : null,
    };
  }
}

export class LockerListResponse {
  @ApiProperty({ type: [LockerResponse] }) items!: LockerResponse[];
  @ApiProperty() total!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() offset!: number;
}
