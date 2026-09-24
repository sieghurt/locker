import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsUUID } from 'class-validator';

import { LockerSize } from '../../lockers/locker-size';

export class StorePackageDto {
  @ApiProperty({ enum: LockerSize, example: LockerSize.SMALL, description: 'Package size' })
  @IsEnum(LockerSize)
  size!: LockerSize;

  @ApiProperty({
    format: 'uuid',
    description: 'Id of the customer account the package is for (GET /users/customers)',
  })
  @IsUUID()
  customerId!: string;
}
