import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { RateLimitBucket } from '../common/rate-limit/rate-limit-bucket.decorator';
import { UserResponse } from '../users/dto/user.response';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import {
  DemoInfoResponse,
  RequestCodeDto,
  RequestCodeResponse,
  VerifyCodeDto,
} from './dto/auth.dto';
import { Public } from './public.decorator';
import { SESSION_COOKIE } from './session.cookie';
import type { SessionUser } from './session-token.service';

const NEUTRAL_MESSAGE = 'If that address belongs to an account, a login code is on its way.';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('otp/request')
  @Public()
  @RateLimitBucket('otp')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Email a one-time login code (same response whether or not the account exists)',
  })
  @ApiResponse({ status: 202, type: RequestCodeResponse })
  async requestCode(@Body() body: RequestCodeDto): Promise<RequestCodeResponse> {
    const demoCode = await this.authService.requestCode(body.email);
    return demoCode ? { message: NEUTRAL_MESSAGE, demoCode } : { message: NEUTRAL_MESSAGE };
  }

  @Get('demo')
  @Public()
  @ApiOperation({
    summary:
      'Demo mode info: whether codes are returned on request, and which accounts exist to try',
    description:
      'Always callable. `enabled` is false and `accounts` empty unless the server runs with DEMO_MODE=true.',
  })
  @ApiResponse({ status: 200, type: DemoInfoResponse })
  async demo(): Promise<DemoInfoResponse> {
    if (!this.authService.isDemoMode) return { enabled: false, accounts: [] };
    const { items } = await this.usersService.list({ active: true, limit: 20, offset: 0 });
    return {
      enabled: true,
      accounts: items.map((u) => ({ email: u.email, role: u.role, displayName: u.displayName })),
    };
  }

  @Post('otp/verify')
  @Public()
  @RateLimitBucket('otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange email + code for a session cookie' })
  @ApiResponse({ status: 200, type: UserResponse })
  @ApiResponse({ status: 401, description: 'INVALID_LOGIN_CODE' })
  async verifyCode(
    @Body() body: VerifyCodeDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserResponse> {
    const { user, token, expiresAt } = await this.authService.verifyCode(body.email, body.code);
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      // `request.secure` honours X-Forwarded-Proto when TRUST_PROXY is on, so https via nginx/ngrok
      // gets a Secure cookie while plain http on localhost still works.
      secure: request.secure,
      expires: expiresAt,
      path: '/',
    });
    return UserResponse.from(user);
  }

  @Post('logout')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear the session cookie' })
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Who am I' })
  @ApiResponse({ status: 200, type: UserResponse })
  @ApiResponse({ status: 401, description: 'NOT_LOGGED_IN' })
  async me(@CurrentUser() session: SessionUser): Promise<UserResponse> {
    return UserResponse.from(await this.usersService.getById(session.id));
  }
}
