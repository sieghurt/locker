import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ForbiddenRoleError, NotLoggedInError } from '../common/errors/domain.errors';
import { UserRole } from '../users/user-role';
import type { AuthenticatedRequest } from './current-user.decorator';
import { IS_PUBLIC } from './public.decorator';
import { ROLES } from './roles.decorator';
import { SESSION_COOKIE } from './session.cookie';
import { SessionTokenService } from './session-token.service';

/**
 * Global guard: every route needs a valid session cookie unless marked @Public(); routes marked
 * @Roles(...) additionally require one of those roles. Runs after the throttler.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionTokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = this.sessions.verify(request.cookies?.[SESSION_COOKIE]);
    if (!user) throw new NotLoggedInError();
    request.user = user;

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets);
    if (roles && roles.length > 0 && !roles.includes(user.role))
      throw new ForbiddenRoleError(roles);
    return true;
  }
}
