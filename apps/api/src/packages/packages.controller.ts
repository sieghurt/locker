import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { SessionUser } from '../auth/session-token.service';
import { RateLimitBucket } from '../common/rate-limit/rate-limit-bucket.decorator';
import { UserRole } from '../users/user-role';
import {
  ChargesSummaryResponse,
  PackageResponse,
  RetrievedPackageResponse,
  StorageChargeResponse,
  StoredPackageResponse,
} from './dto/package.response';
import { RetrievePackageDto } from './dto/retrieve-package.dto';
import { StorePackageDto } from './dto/store-package.dto';
import { PackagesService } from './packages.service';

@ApiTags('packages')
@ApiCookieAuth()
@Controller('packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Post()
  @Roles(UserRole.AGENT, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Agent/admin: store a package in the smallest available locker that fits',
    description:
      'The pickup code is emailed to the customer. It is included in the response only for ADMIN callers; agents get everything else.',
  })
  @ApiResponse({ status: 201, type: StoredPackageResponse })
  @ApiResponse({ status: 422, description: 'CUSTOMER_NOT_FOUND: not an active customer account' })
  @ApiResponse({
    status: 409,
    description: 'NO_SUITABLE_LOCKER: the package cannot be stored right now',
  })
  async store(
    @Body() body: StorePackageDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<StoredPackageResponse> {
    const stored = await this.packagesService.store(body);
    // The customer gets the code by email. Agents never see it; admins can, to help at the kiosk.
    // `undefined` is dropped by JSON serialisation, so the key never reaches an agent's response.
    return actor.role === UserRole.ADMIN ? stored : { ...stored, pickupCode: undefined };
  }

  @Post('retrieve')
  @Roles(UserRole.CUSTOMER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @RateLimitBucket('pickup')
  @ApiOperation({ summary: 'Customer: retrieve a package with locker id + pickup code' })
  @ApiResponse({ status: 200, type: RetrievedPackageResponse })
  @ApiResponse({ status: 403, description: 'INVALID_PICKUP_CODE or NOT_YOUR_PACKAGE' })
  @ApiResponse({ status: 423, description: 'PICKUP_LOCKED: too many wrong codes for this locker' })
  @ApiResponse({ status: 404, description: 'LOCKER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'LOCKER_EMPTY' })
  @ApiResponse({ status: 429, description: 'Too many pickup attempts' })
  async retrieve(
    @Body() body: RetrievePackageDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<RetrievedPackageResponse> {
    const result = await this.packagesService.retrieve(body, actor);
    return { ...result, storageCharge: StorageChargeResponse.from(result.storageCharge) };
  }

  @Get('mine')
  @Roles(UserRole.CUSTOMER)
  @ApiOperation({
    summary:
      'Customer: my packages, newest first, each with what it owes (never returns pickup codes)',
  })
  @ApiResponse({ status: 200, type: [PackageResponse] })
  async mine(@CurrentUser() actor: SessionUser): Promise<PackageResponse[]> {
    const packages = await this.packagesService.listMine(actor);
    return packages.map((pkg) => PackageResponse.from(pkg, this.packagesService.chargeSoFar(pkg)));
  }

  @Get('charges')
  @Roles(UserRole.ADMIN)
  @ApiOperation({
    summary: 'Admin: what the station is owed on waiting packages, and what it has charged',
  })
  @ApiResponse({ status: 200, type: ChargesSummaryResponse })
  async charges(): Promise<ChargesSummaryResponse> {
    return this.packagesService.chargesSummary();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Look up a package (never returns the pickup code); customers see only their own',
  })
  @ApiResponse({ status: 200, type: PackageResponse })
  @ApiResponse({ status: 404, description: 'PACKAGE_NOT_FOUND' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<PackageResponse> {
    const pkg = await this.packagesService.getById(id, actor);
    return PackageResponse.from(pkg, this.packagesService.chargeSoFar(pkg));
  }
}
