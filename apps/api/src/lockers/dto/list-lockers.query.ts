import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { LockerSize } from '../locker-size';
import { LockerStatus } from '../locker-status';

export const LIST_LOCKERS_DEFAULT_LIMIT = 100;
export const LIST_LOCKERS_MAX_LIMIT = 500;

export class ListLockersQuery {
  @ApiPropertyOptional({ enum: LockerStatus })
  @IsOptional()
  @IsEnum(LockerStatus)
  status?: LockerStatus;

  @ApiPropertyOptional({ enum: LockerSize })
  @IsOptional()
  @IsEnum(LockerSize)
  size?: LockerSize;

  @ApiPropertyOptional({ default: LIST_LOCKERS_DEFAULT_LIMIT, maximum: LIST_LOCKERS_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIST_LOCKERS_MAX_LIMIT)
  limit: number = LIST_LOCKERS_DEFAULT_LIMIT;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset: number = 0;
}
