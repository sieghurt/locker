import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches } from 'class-validator';

export class RetrievePackageDto {
  @ApiProperty({ format: 'uuid', description: 'Locker identifier shown to the customer' })
  @IsUUID()
  lockerId!: string;

  @ApiProperty({ example: '482913', description: 'Pickup code the customer received' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{4,12}$/, { message: 'pickupCode must be 4 to 12 digits' })
  pickupCode!: string;
}
