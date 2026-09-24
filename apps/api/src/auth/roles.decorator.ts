import { SetMetadata } from '@nestjs/common';

import { UserRole } from '../users/user-role';

export const ROLES = 'roles';

/** Restricts a handler (or whole controller) to the given roles. Without it, any logged-in user may call it. */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES, roles);
