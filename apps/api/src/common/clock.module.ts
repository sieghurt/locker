import { Global, Module } from '@nestjs/common';

import { Clock, SystemClock } from './clock';

/** Global so any feature module can inject `Clock` without re-declaring the binding. */
@Global()
@Module({
  providers: [{ provide: Clock, useClass: SystemClock }],
  exports: [Clock],
})
export class ClockModule {}
