import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches } from 'class-validator';

const trimLower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RequestCodeDto {
  @ApiProperty({ example: 'alice@example.com' })
  @Transform(trimLower)
  @IsEmail()
  @Length(3, 254)
  email!: string;
}

export class VerifyCodeDto extends RequestCodeDto {
  @ApiProperty({ example: '482913' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Matches(/^\d{4,10}$/, { message: 'code must be 4 to 10 digits' })
  code!: string;
}

export class RequestCodeResponse {
  @ApiProperty({ example: 'If that address belongs to an account, a login code is on its way.' })
  message!: string;

  @ApiPropertyOptional({
    example: '482913',
    description: 'Only present when DEMO_MODE is on: the code that was emailed',
  })
  demoCode?: string;
}

export class DemoAccountResponse {
  @ApiProperty() email!: string;
  @ApiProperty() role!: string;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
}

export class DemoInfoResponse {
  @ApiProperty({ description: 'Whether DEMO_MODE is on' }) enabled!: boolean;
  @ApiProperty({
    type: [DemoAccountResponse],
    description: 'Active accounts to log in as; empty unless enabled',
  })
  accounts!: DemoAccountResponse[];
}
