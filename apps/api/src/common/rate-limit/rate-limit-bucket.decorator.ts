import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_BUCKET = 'rateLimitBucket';

/** Named per-IP limits configured in AppModule. Handlers opt into a bucket; everything else gets only the default limit. */
export type RateLimitBucketName = 'pickup' | 'otp';

/**
 * Marks a handler as subject to a stricter named throttler. `pickup` guards 6-digit pickup codes,
 * `otp` guards login-code requests and verification.
 */
export const RateLimitBucket = (bucket: RateLimitBucketName): MethodDecorator =>
  SetMetadata(RATE_LIMIT_BUCKET, bucket);
