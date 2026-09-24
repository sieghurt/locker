import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProperty, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { SessionUser } from '../auth/session-token.service';
import { UserRole } from '../users/user-role';
import { PackagesService } from './packages.service';

export class RevealedPickupCodeResponse {
  @ApiProperty({ example: 'S-01' }) lockerLabel!: string;
  @ApiProperty({ example: 'Alice' }) customerLabel!: string;
  @ApiProperty({ example: '482913' }) pickupCode!: string;
}

/** Admin assistance at the kiosk: read the code of the package waiting in a locker. */
@ApiTags('lockers')
@ApiCookieAuth()
@Controller('lockers')
export class PickupCodeController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get(':id/pickup-code')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: the pickup code of the package waiting in this locker (logged)',
    description:
      'For helping a customer who cannot reach their email. Only while the package is STORED; the recoverable copy is wiped on retrieval.',
  })
  @ApiResponse({ status: 200, type: RevealedPickupCodeResponse })
  @ApiResponse({ status: 404, description: 'LOCKER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'LOCKER_EMPTY or PICKUP_CODE_UNAVAILABLE' })
  async reveal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<RevealedPickupCodeResponse> {
    return this.packagesService.revealPickupCode(id, actor);
  }
}
