import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Length, Max, Min, NotEquals } from 'class-validator';

export class RecordAdjustmentDto {
  @ApiProperty({
    example: -40,
    description:
      'Signed correction: negative credits the customer, positive charges them. Never zero.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-9_999_999_999)
  @Max(9_999_999_999)
  @NotEquals(0)
  amount!: number;

  @ApiProperty({ example: 'Payment recorded twice on 24 Sep' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(3, 160)
  reason!: string;
}

export class RecordPaymentDto {
  @ApiProperty({
    example: 90,
    description: 'Amount received from the customer, in the station currency',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  // numeric(12,2) in the database: a larger figure would fail as a 500 instead of a validation error.
  @Max(9_999_999_999)
  amount!: number;

  @ApiPropertyOptional({ example: 'Cash at the kiosk' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 160)
  note?: string;
}
