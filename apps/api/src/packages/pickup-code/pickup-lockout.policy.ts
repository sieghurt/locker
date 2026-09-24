/**
 * How many wrong codes a package tolerates and how long its locker then refuses pickups.
 * Bound from the environment in PackagesModule; a plain value so services stay unit-testable.
 */
export class PickupLockoutPolicy {
  constructor(
    readonly maxFailedAttempts: number,
    readonly lockoutMs: number,
  ) {
    if (!Number.isInteger(maxFailedAttempts) || maxFailedAttempts < 1) {
      throw new RangeError('maxFailedAttempts must be a positive integer');
    }
    if (!Number.isFinite(lockoutMs) || lockoutMs <= 0) {
      throw new RangeError('lockoutMs must be positive');
    }
  }
}
