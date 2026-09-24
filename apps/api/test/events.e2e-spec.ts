import { LockerSize } from '../src/lockers/locker-size';
import {
  Actors,
  createLocker,
  createTestApp,
  resetDatabase,
  retrieve,
  seedActors,
  storePackage,
  TestContext,
} from './utils/test-app';

/** Reads SSE frames from a fetch stream until `count` named events (non-heartbeat) have arrived. */
async function collectEvents(
  url: string,
  cookie: string,
  count: number,
  trigger: () => Promise<void>,
) {
  const controller = new AbortController();
  const response = await fetch(url, {
    signal: controller.signal,
    headers: { accept: 'text/event-stream', cookie },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  let buffer = '';
  await trigger();

  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const type = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      if (type && data && type !== 'heartbeat') events.push({ type, data: JSON.parse(data) });
    }
  }
  controller.abort();
  return events;
}

describe('Locker events (e2e) - live updates over Server-Sent Events', () => {
  let ctx: TestContext;
  let a: Actors;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    a = await seedActors(ctx);
  });
  afterAll(async () => {
    (ctx.app.getHttpServer() as import('node:http').Server).closeAllConnections();
    await ctx?.app.close();
  });

  it('requires a session', async () => {
    const res = await fetch(`${ctx.baseUrl}/api/lockers/events`, {
      headers: { accept: 'text/event-stream' },
    });
    expect(res.status).toBe(401);
  });

  it('streams stored and retrieved events with customer labels, never the code or the email', async () => {
    const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    let code = '';

    const events = await collectEvents(
      `${ctx.baseUrl}/api/lockers/events`,
      a.agent.cookie,
      2,
      async () => {
        const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
        code = stored.pickupCode;
        await retrieve(a.customer, locker.id, code).expect(200);
      },
    );

    expect(events.map((e) => e.type)).toEqual(['package.stored', 'package.retrieved']);
    expect(events[0].data).toMatchObject({
      lockerId: locker.id,
      lockerLabel: 'S-01',
      status: 'OCCUPIED',
      customerLabel: 'Alice',
    });
    expect(events[1].data).toMatchObject({
      lockerId: locker.id,
      status: 'AVAILABLE',
      customerLabel: 'Alice',
    });
    const raw = JSON.stringify(events);
    expect(raw).not.toContain(code);
    expect(raw).not.toContain('alice@test.local');
  });

  it("leaves the customer's name out of a customer's own stream", async () => {
    const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    const events = await collectEvents(
      `${ctx.baseUrl}/api/lockers/events`,
      a.customer.cookie,
      1,
      async () => {
        await storePackage(a.agent, LockerSize.SMALL, a.customer2);
      },
    );
    expect(events[0].data).toMatchObject({ lockerId: locker.id, status: 'OCCUPIED' });
    expect(events[0].data.customerLabel).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain('Bob');
  });

  it('announces newly created lockers', async () => {
    const events = await collectEvents(
      `${ctx.baseUrl}/api/lockers/events`,
      a.customer.cookie,
      1,
      async () => {
        await createLocker(a.admin, 'L-01', LockerSize.LARGE);
      },
    );
    expect(events[0]).toMatchObject({
      type: 'locker.created',
      data: { lockerLabel: 'L-01', lockerSize: 'LARGE', status: 'AVAILABLE' },
    });
  });
});
