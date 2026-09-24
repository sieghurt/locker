import { Injectable } from '@nestjs/common';

/** Injectable time source so storage durations can be tested without waiting for days to pass. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
