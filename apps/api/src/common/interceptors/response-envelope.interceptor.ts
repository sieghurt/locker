import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { SSE_METADATA } from '@nestjs/common/constants';
import { Observable, map } from 'rxjs';

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

/**
 * Wraps every successful controller result as `{ success: true, data }`.
 * Server-Sent Events handlers (`@Sse()`) are passed through untouched: their stream of MessageEvents
 * is the wire format itself, and wrapping it would strip the `event:` names clients subscribe to.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, SuccessEnvelope<T> | T> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<SuccessEnvelope<T> | T> {
    if (Reflect.getMetadata(SSE_METADATA, context.getHandler()) === true) {
      return next.handle();
    }
    return next.handle().pipe(map((data) => ({ success: true as const, data })));
  }
}
