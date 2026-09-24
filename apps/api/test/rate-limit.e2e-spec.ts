import './rate-limit.env';

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

describe('Rate limiting (e2e)', () => {
  let ctx: TestContext;
  let a: Actors;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    a = await seedActors(ctx);
  });
  afterAll(() => ctx?.app.close());

  it('throttles pickup attempts per client (PICKUP_RATE_LIMIT_PER_MINUTE=3) with the standard envelope', async () => {
    const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
    const wrong = stored.pickupCode === '000000' ? '000001' : '000000';

    await retrieve(a.customer, locker.id, wrong).expect(403);
    await retrieve(a.customer, locker.id, wrong).expect(403);
    await retrieve(a.customer, locker.id, wrong).expect(423);
    const throttled = await retrieve(a.customer, locker.id, wrong).expect(429);
    expect(throttled.body).toMatchObject({ success: false, error: { code: 'TOO_MANY_REQUESTS' } });
  });

  it('does not apply the pickup limit to other endpoints', async () => {
    for (let i = 0; i < 6; i++) await a.customer.http.get('/api/lockers').expect(200);
  });
});
