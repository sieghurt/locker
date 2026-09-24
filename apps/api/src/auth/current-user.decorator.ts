import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { SessionUser } from './session-token.service';

export interface AuthenticatedRequest {
  user?: SessionUser;
  cookies?: Record<string, string | undefined>;
}

/** The logged-in user, placed on the request by SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) throw new Error('CurrentUser used on a route without SessionGuard');
    return request.user;
  },
);
