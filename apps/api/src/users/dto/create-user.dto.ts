import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Length } from 'class-validator';

import { UserRole } from '../user-role';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateUserDto {
  @ApiProperty({ example: 'alice@example.com' })
  @Transform(trimLower)
  @IsEmail()
  @Length(3, 254)
  email!: string;

  @ApiProperty({ enum: UserRole, example: UserRole.CUSTOMER })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ example: 'Alice', description: 'Shown to staff instead of the email' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  displayName?: string;
}
