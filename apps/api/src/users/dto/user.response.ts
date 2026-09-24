import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { publicLabel, User } from '../user.entity';
import { UserRole } from '../user-role';

/** Full record: for admins and for a user looking at themselves. */
export class UserResponse {
  @ApiProperty() id!: string;
  @ApiProperty() email!: string;
  @ApiProperty({ enum: UserRole }) role!: UserRole;
  @ApiPropertyOptional({ nullable: true }) displayName!: string | null;
  @ApiProperty() active!: boolean;
  @ApiPropertyOptional({ nullable: true }) lastLoginAt!: Date | null;
  @ApiProperty() createdAt!: Date;

  static from(u: User): UserResponse {
    return {
      id: u.id,
      email: u.email,
      role: u.role,
      displayName: u.displayName,
      active: u.active,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    };
  }
}

/** What an agent sees when choosing a recipient: enough to pick the right person, no full email. */
export class CustomerSummaryResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Alice', description: 'Display name, or a masked email' }) label!: string;
  @ApiProperty({ example: 'al***@example.com' }) maskedEmail!: string;

  static from(u: User): CustomerSummaryResponse {
    return {
      id: u.id,
      label: publicLabel(u),
      maskedEmail: publicLabel({ email: u.email, displayName: null }),
    };
  }
}

export class UserListResponse {
  @ApiProperty({ type: [UserResponse] }) items!: UserResponse[];
  @ApiProperty() total!: number;
}

export class CustomerListResponse {
  @ApiProperty({ type: [CustomerSummaryResponse] }) items!: CustomerSummaryResponse[];
  @ApiProperty() total!: number;
}
