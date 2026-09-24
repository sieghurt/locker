import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, interval, map, merge } from 'rxjs';

import { LockerSize } from './locker-size';
import { LockerStatus } from './locker-status';

export type LockerEventType = 'locker.created' | 'package.stored' | 'package.retrieved';

export interface LockerEvent {
  type: LockerEventType;
  at: string;
  lockerId: string;
  lockerLabel: string;
  lockerSize: LockerSize;
  status: LockerStatus;
  /** Package involved, when the event is about one. Never carries the pickup code. */
  packageId?: string;
  /** Display name or masked email of the customer; never the full address. */
  customerLabel?: string;
}

/** Keeps proxies (nginx, ngrok) from closing an idle stream. */
export const SSE_HEARTBEAT_MS = 15_000;

/**
 * In-process broadcast of locker state changes for the Server-Sent Events endpoint. Publishers call
 * `publish` *after* their transaction commits, so a subscriber never learns about a change that was
 * rolled back. With several API replicas this would move to a shared channel (Postgres LISTEN/NOTIFY
 * or Redis); the interface stays the same.
 */
@Injectable()
export class LockerEventsService {
  private readonly events$ = new Subject<LockerEvent>();

  publish(event: Omit<LockerEvent, 'at'>): void {
    this.events$.next({ ...event, at: new Date().toISOString() });
  }

  /**
   * SSE frames: every locker event, plus a heartbeat while nothing happens. `includeCustomer` is false
   * for customers, who should not learn who else has a package waiting.
   */
  stream(includeCustomer: boolean): Observable<MessageEvent> {
    const changes = this.events$.pipe(
      // `undefined` is dropped by JSON serialisation, so the field never reaches a customer's stream.
      map((event): MessageEvent => ({
        type: event.type,
        data: includeCustomer ? event : { ...event, customerLabel: undefined },
      })),
    );
    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'heartbeat', data: { at: new Date().toISOString() } })),
    );
    return merge(changes, heartbeat);
  }
}
