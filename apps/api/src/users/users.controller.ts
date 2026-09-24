import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import type { SessionUser } from '../auth/session-token.service';
import { CreateUserDto } from './dto/create-user.dto';
import { ListUsersQuery } from './dto/list-users.query';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  CustomerListResponse,
  CustomerSummaryResponse,
  UserListResponse,
  UserResponse,
} from './dto/user.response';
import { UserRole } from './user-role';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('customers')
  @Roles(UserRole.AGENT, UserRole.ADMIN)
  @ApiOperation({ summary: 'Agent: find the customer a package is for (masked emails)' })
  @ApiResponse({ status: 200, type: CustomerListResponse })
  async customers(@Query() query: ListUsersQuery): Promise<CustomerListResponse> {
    const { items, total } = await this.usersService.list({
      ...query,
      role: UserRole.CUSTOMER,
      active: true,
    });
    return { items: items.map((u) => CustomerSummaryResponse.from(u)), total };
  }

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: list users' })
  @ApiResponse({ status: 200, type: UserListResponse })
  async list(@Query() query: ListUsersQuery): Promise<UserListResponse> {
    const { items, total } = await this.usersService.list(query);
    return { items: items.map((u) => UserResponse.from(u)), total };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Admin: create a user of any role' })
  @ApiResponse({ status: 201, type: UserResponse })
  @ApiResponse({ status: 409, description: 'EMAIL_TAKEN' })
  async create(@Body() body: CreateUserDto): Promise<UserResponse> {
    return UserResponse.from(await this.usersService.create(body));
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: one user' })
  @ApiResponse({ status: 200, type: UserResponse })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<UserResponse> {
    return UserResponse.from(await this.usersService.getById(id));
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin: change role, display name or active flag' })
  @ApiResponse({ status: 200, type: UserResponse })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateUserDto,
    @CurrentUser() actor: SessionUser,
  ): Promise<UserResponse> {
    // Admins cannot lock themselves out by demoting or deactivating their own account.
    if (actor.id === id && (body.active === false || (body.role && body.role !== UserRole.ADMIN))) {
      body = { ...body, active: undefined, role: undefined };
    }
    return UserResponse.from(await this.usersService.update(id, body));
  }
}
