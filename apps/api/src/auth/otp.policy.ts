/** How login codes behave. Bound from the environment in AuthModule. */
export class OtpPolicy {
  constructor(
    readonly length: number,
    readonly ttlMs: number,
    readonly maxAttempts: number,
    /** Codes a user may request within `requestWindowMs` before further requests are silently dropped. */
    readonly maxRequestsPerWindow: number,
    readonly requestWindowMs: number,
  ) {
    if (length < 4 || length > 10) throw new RangeError('otp length must be 4..10');
    if (ttlMs <= 0 || maxAttempts < 1 || maxRequestsPerWindow < 1 || requestWindowMs <= 0) {
      throw new RangeError('otp policy values must be positive');
    }
  }
}
