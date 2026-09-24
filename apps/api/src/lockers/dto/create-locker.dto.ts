import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, Length, Matches } from 'class-validator';

import { LockerSize } from '../locker-size';

export class CreateLockerDto {
  @ApiProperty({ example: 'A-01', description: 'Unique label printed on the locker door' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 32)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 _-]*$/, {
    message: 'label may contain letters, digits, spaces, hyphens and underscores',
  })
  label!: string;

  @ApiProperty({ enum: LockerSize, example: LockerSize.MEDIUM })
  @IsEnum(LockerSize)
  size!: LockerSize;
}
