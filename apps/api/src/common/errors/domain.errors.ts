/**
 * Business-rule violations. They carry an HTTP status and a stable machine-readable code but are
 * framework-agnostic: services throw them, the HTTP exception filter translates them at the edge.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  protected constructor(
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NoSuitableLockerError extends DomainError {
  readonly code = 'NO_SUITABLE_LOCKER';
  readonly httpStatus = 409;

  constructor(packageSize: string) {
    super(
      `No available locker can accommodate a ${packageSize} package; it cannot be stored right now`,
      {
        packageSize,
      },
    );
  }
}

export class LockerNotFoundError extends DomainError {
  readonly code = 'LOCKER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(lockerId: string) {
    super(`Locker ${lockerId} does not exist`, { lockerId });
  }
}

export class LockerLabelTakenError extends DomainError {
  readonly code = 'LOCKER_LABEL_TAKEN';
  readonly httpStatus = 409;

  constructor(label: string) {
    super(`A locker labelled "${label}" already exists`, { label });
  }
}

export class LockerEmptyError extends DomainError {
  readonly code = 'LOCKER_EMPTY';
  readonly httpStatus = 409;

  constructor(lockerId: string) {
    super(`Locker ${lockerId} has no package waiting for pickup`, { lockerId });
  }
}

export class InvalidPickupCodeError extends DomainError {
  readonly code = 'INVALID_PICKUP_CODE';
  readonly httpStatus = 403;

  constructor() {
    super('The pickup code does not match the package in this locker');
  }
}

export class PickupLockedError extends DomainError {
  readonly code = 'PICKUP_LOCKED';
  readonly httpStatus = 423;

  constructor(lockerId: string, lockedUntil: Date) {
    super(
      `Too many wrong pickup codes for locker ${lockerId}; pickup is locked until ${lockedUntil.toISOString()}`,
      { lockerId, lockedUntil: lockedUntil.toISOString() },
    );
  }
}

export class PackageNotFoundError extends DomainError {
  readonly code = 'PACKAGE_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(packageId: string) {
    super(`Package ${packageId} does not exist`, { packageId });
  }
}

export class PickupCodeGenerationError extends DomainError {
  readonly code = 'PICKUP_CODE_GENERATION_FAILED';
  readonly httpStatus = 503;

  constructor(attempts: number) {
    super(`Could not generate a unique pickup code after ${attempts} attempts; please retry`, {
      attempts,
    });
  }
}

export class NotLoggedInError extends DomainError {
  readonly code = 'NOT_LOGGED_IN';
  readonly httpStatus = 401;

  constructor() {
    super('Log in to continue');
  }
}

export class ForbiddenRoleError extends DomainError {
  readonly code = 'FORBIDDEN';
  readonly httpStatus = 403;

  constructor(allowed: string[]) {
    super('Your account is not allowed to do this', { allowedRoles: allowed });
  }
}

export class InvalidLoginCodeError extends DomainError {
  readonly code = 'INVALID_LOGIN_CODE';
  readonly httpStatus = 401;

  constructor() {
    super('That code is not valid. Request a new one and try again.');
  }
}

export class EmailTakenError extends DomainError {
  readonly code = 'EMAIL_TAKEN';
  readonly httpStatus = 409;

  constructor() {
    super('A user with that email already exists');
  }
}

export class UserNotFoundError extends DomainError {
  readonly code = 'USER_NOT_FOUND';
  readonly httpStatus = 404;

  constructor(userId: string) {
    super(`User ${userId} does not exist`, { userId });
  }
}

export class CustomerNotFoundError extends DomainError {
  readonly code = 'CUSTOMER_NOT_FOUND';
  readonly httpStatus = 422;

  constructor(customerId: string) {
    super('The package must be addressed to an active customer account', { customerId });
  }
}

export class NotYourPackageError extends DomainError {
  readonly code = 'NOT_YOUR_PACKAGE';
  readonly httpStatus = 403;

  constructor(lockerId: string) {
    super('The package in this locker is not addressed to your account', { lockerId });
  }
}

export class PickupCodeUnavailableError extends DomainError {
  readonly code = 'PICKUP_CODE_UNAVAILABLE';
  readonly httpStatus = 409;

  constructor(lockerId: string) {
    super(
      'The pickup code for this package cannot be recovered (it was stored before codes became recoverable)',
      {
        lockerId,
      },
    );
  }
}
