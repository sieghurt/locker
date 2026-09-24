import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Observable } from 'rxjs';

import { CreateLockerDto } from './dto/create-locker.dto';
import { ListLockersQuery } from './dto/list-lockers.query';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { SessionUser } from '../auth/session-token.service';
import { UserRole } from '../users/user-role';
import { LockerListResponse, LockerResponse } from './dto/locker.response';
import { LockerEventsService } from './locker-events.service';
import { LockersService } from './lockers.service';

@ApiTags('lockers')
@ApiCookieAuth()
@Controller('lockers')
export class LockersController {
  constructor(
    private readonly lockersService: LockersService,
    private readonly lockerEvents: LockerEventsService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Admin: create a locker of a given size' })
  @ApiResponse({ status: 201, type: LockerResponse })
  @ApiResponse({ status: 409, description: 'LOCKER_LABEL_TAKEN' })
  async create(@Body() body: CreateLockerDto): Promise<LockerResponse> {
    return LockerResponse.from(await this.lockersService.create(body));
  }

  @Get()
  @ApiOperation({ summary: 'List lockers with their current availability' })
  @ApiResponse({ status: 200, type: LockerListResponse })
  async list(
    @Query() query: ListLockersQuery,
    @CurrentUser() actor: SessionUser,
  ): Promise<LockerListResponse> {
    const { items, total } = await this.lockersService.list(query);
    // Who a package belongs to is staff information; a customer sees only that a locker is occupied.
    const staff = actor.role !== UserRole.CUSTOMER;
    const labels = staff
      ? await this.lockersService.customerLabels(items)
      : new Map<string, string>();
    // Only admins see what other people's packages owe.
    const accrued = (locker: (typeof items)[number]) =>
      actor.role === UserRole.ADMIN && locker.currentPackage
        ? this.lockersService.accruedCharge(locker.currentPackage.storedAt)
        : undefined;
    return {
      items: items.map((locker) =>
        LockerResponse.from(locker, labelFor(locker, labels), accrued(locker)),
      ),
      total,
      limit: query.limit,
      offset: query.offset,
    };
  }

  @Sse('events')
  @SkipThrottle()
  @ApiOperation({
    summary: 'Live locker changes (Server-Sent Events)',
    description:
      'Emits `locker.created`, `package.stored` and `package.retrieved` events after each change commits, ' +
      'plus a `heartbeat` every 15 s. Clients refetch GET /lockers on any event. Never includes pickup codes.',
  })
  @ApiProduces('text/event-stream')
  events(@CurrentUser() actor: SessionUser): Observable<MessageEvent> {
    return this.lockerEvents.stream(actor.role !== UserRole.CUSTOMER);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one locker and, if occupied, a summary of the package inside' })
  @ApiResponse({ status: 200, type: LockerResponse })
  @ApiResponse({ status: 404, description: 'LOCKER_NOT_FOUND' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<LockerResponse> {
    const locker = await this.lockersService.getById(id);
    const staff = actor.role !== UserRole.CUSTOMER;
    const labels = staff
      ? await this.lockersService.customerLabels([locker])
      : new Map<string, string>();
    const accrued =
      actor.role === UserRole.ADMIN && locker.currentPackage
        ? this.lockersService.accruedCharge(locker.currentPackage.storedAt)
        : undefined;
    return LockerResponse.from(locker, labelFor(locker, labels), accrued);
  }
}

function labelFor(
  locker: { currentPackage?: { customerUserId: string | null } | null },
  labels: Map<string, string>,
): string | undefined {
  const id = locker.currentPackage?.customerUserId;
  return id ? labels.get(id) : undefined;
}
