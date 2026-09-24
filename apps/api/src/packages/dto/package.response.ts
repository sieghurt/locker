import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { LockerSize } from '../../lockers/locker-size';
import { StorageCharge } from '../../pricing/storage-pricing.strategy';
import { Package } from '../package.entity';
import { PackageStatus } from '../package-status';

export class StoredPackageResponse {
  @ApiProperty() packageId!: string;
  @ApiProperty() lockerId!: string;
  @ApiProperty({ example: 'A-01' }) lockerLabel!: string;
  @ApiProperty({ enum: LockerSize }) lockerSize!: LockerSize;
  @ApiProperty({ enum: LockerSize }) packageSize!: LockerSize;
  @ApiPropertyOptional({
    example: '482913',
    description: 'Emailed to the customer. Present in the response only for ADMIN callers.',
  })
  pickupCode?: string;
  @ApiProperty() storedAt!: Date;
  @ApiProperty({ example: { id: 'uuid', label: 'Alice' } }) customer!: {
    id: string;
    label: string;
  };
  @ApiProperty({ description: 'Whether the code was emailed to the customer' }) notified!: boolean;
}

export class StorageChargeTierResponse {
  @ApiProperty() tier!: number;
  @ApiProperty() days!: number;
  @ApiProperty() ratePerDay!: number;
  @ApiProperty() amount!: number;
}

export class StorageChargeResponse {
  @ApiProperty({ example: 'UNITS' }) currency!: string;
  @ApiProperty() totalDays!: number;
  @ApiProperty() freeDays!: number;
  @ApiProperty() chargedDays!: number;
  @ApiProperty() amount!: number;
  @ApiProperty({ type: [StorageChargeTierResponse] }) breakdown!: StorageChargeTierResponse[];

  static from(charge: StorageCharge): StorageChargeResponse {
    return {
      currency: charge.currency,
      totalDays: charge.totalDays,
      freeDays: charge.freeDays,
      chargedDays: charge.chargedDays,
      amount: charge.amount,
      breakdown: charge.breakdown,
    };
  }
}

export class RetrievedPackageResponse {
  @ApiProperty() packageId!: string;
  @ApiProperty() lockerId!: string;
  @ApiProperty({ example: 'A-01' }) lockerLabel!: string;
  @ApiProperty({ example: true, description: 'Signal to the hardware layer to open the door' })
  lockerOpened!: true;
  @ApiProperty() storedAt!: Date;
  @ApiProperty() retrievedAt!: Date;
  @ApiProperty({ type: StorageChargeResponse }) storageCharge!: StorageChargeResponse;
}

export class ChargesSummaryResponse {
  @ApiProperty({ example: 'UNITS' }) currency!: string;
  @ApiProperty({
    example: { packages: 3, amount: 70 },
    description: 'Packages still in lockers and what they have run up so far',
  })
  outstanding!: { packages: number; amount: number };
  @ApiProperty({
    example: { packages: 12, amount: 340 },
    description: 'Packages already collected and what was charged',
  })
  collected!: { packages: number; amount: number };
}

export class PackageResponse {
  @ApiProperty() id!: string;
  @ApiProperty() lockerId!: string;
  @ApiProperty({ enum: LockerSize }) size!: LockerSize;
  @ApiPropertyOptional({
    nullable: true,
    description: 'Customer account the package is addressed to',
  })
  customerUserId!: string | null;
  @ApiProperty({ enum: PackageStatus }) status!: PackageStatus;
  @ApiProperty() storedAt!: Date;
  @ApiPropertyOptional({ nullable: true }) retrievedAt!: Date | null;
  @ApiPropertyOptional({ nullable: true, description: 'Amount charged at collection' })
  storageCharge!: number | null;
  @ApiPropertyOptional({ nullable: true }) chargedDays!: number | null;
  @ApiPropertyOptional({
    type: StorageChargeResponse,
    description:
      'What is owed: running total while the package waits, or the amount charged once collected.',
  })
  charge?: StorageChargeResponse;

  static from(pkg: Package, charge?: StorageCharge): PackageResponse {
    return {
      id: pkg.id,
      lockerId: pkg.lockerId,
      size: pkg.size,
      customerUserId: pkg.customerUserId,
      status: pkg.status,
      storedAt: pkg.storedAt,
      retrievedAt: pkg.retrievedAt,
      storageCharge: pkg.storageCharge,
      chargedDays: pkg.chargedDays,
      ...(charge ? { charge: StorageChargeResponse.from(charge) } : {}),
    };
  }
}
