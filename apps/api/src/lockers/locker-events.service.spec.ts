import { firstValueFrom } from 'rxjs';

import { LockerEventsService } from './locker-events.service';
import { LockerSize } from './locker-size';
import { LockerStatus } from './locker-status';

describe('LockerEventsService', () => {
  it('delivers published events to subscribers as typed SSE messages with a timestamp', async () => {
    const service = new LockerEventsService();
    const next = firstValueFrom(service.stream(true));

    service.publish({
      type: 'package.stored',
      lockerId: 'l1',
      lockerLabel: 'S-01',
      lockerSize: LockerSize.SMALL,
      status: LockerStatus.OCCUPIED,
      packageId: 'p1',
      customerLabel: 'Alice',
    });

    const message = await next;
    expect(message.type).toBe('package.stored');
    expect(message.data).toMatchObject({
      lockerId: 'l1',
      status: 'OCCUPIED',
      at: expect.any(String),
    });
  });

  it('does not replay events published before a client subscribed', async () => {
    const service = new LockerEventsService();
    service.publish({
      type: 'locker.created',
      lockerId: 'old',
      lockerLabel: 'X',
      lockerSize: LockerSize.LARGE,
      status: LockerStatus.AVAILABLE,
    });

    const next = firstValueFrom(service.stream(true));
    service.publish({
      type: 'locker.created',
      lockerId: 'new',
      lockerLabel: 'Y',
      lockerSize: LockerSize.LARGE,
      status: LockerStatus.AVAILABLE,
    });
    expect((await next).data).toMatchObject({ lockerId: 'new' });
  });

  it('hides who a package belongs to from customers', async () => {
    const service = new LockerEventsService();
    const next = firstValueFrom(service.stream(false));

    service.publish({
      type: 'package.stored',
      lockerId: 'l1',
      lockerLabel: 'S-01',
      lockerSize: LockerSize.SMALL,
      status: LockerStatus.OCCUPIED,
      packageId: 'p1',
      customerLabel: 'Alice',
    });

    const message = await next;
    expect(message.data).toMatchObject({ lockerId: 'l1', status: 'OCCUPIED' });
    expect(JSON.stringify(message.data)).not.toContain('Alice');
  });
});
