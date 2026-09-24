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

interface StoreOutcome {
  status: number;
  lockerId?: string;
  code?: string;
}

describe('Concurrency (e2e) - Level 4', () => {
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

  const storeConcurrently = (count: number, size: LockerSize): Promise<StoreOutcome[]> =>
    Promise.all(
      Array.from({ length: count }, () =>
        a.agent.http
          .post('/api/packages')
          .send({ size, customerId: a.customer.user.id })
          .then((res) => ({
            status: res.status,
            lockerId: res.body?.data?.lockerId as string | undefined,
            code: res.body?.error?.code as string | undefined,
          })),
      ),
    );

  it('gives each locker to exactly one request and rejects the rest when demand exceeds supply', async () => {
    const lockers = [
      await createLocker(a.admin, 'S-01', LockerSize.SMALL),
      await createLocker(a.admin, 'S-02', LockerSize.SMALL),
      await createLocker(a.admin, 'M-01', LockerSize.MEDIUM),
      await createLocker(a.admin, 'M-02', LockerSize.MEDIUM),
      await createLocker(a.admin, 'L-01', LockerSize.LARGE),
    ];

    const outcomes = await storeConcurrently(40, LockerSize.SMALL);
    const won = outcomes.filter((o) => o.status === 201);
    const lost = outcomes.filter((o) => o.status === 409);

    expect(won).toHaveLength(lockers.length);
    expect(lost).toHaveLength(40 - lockers.length);
    expect(lost.every((o) => o.code === 'NO_SUITABLE_LOCKER')).toBe(true);
    expect(outcomes.filter((o) => o.status >= 500)).toHaveLength(0);

    const assigned = won.map((o) => o.lockerId).sort();
    expect(new Set(assigned).size).toBe(lockers.length);
    expect(assigned).toEqual(lockers.map((l) => l.id).sort());

    const list = await a.admin.http.get('/api/lockers').expect(200);
    expect(list.body.data.items.every((l: { status: string }) => l.status === 'OCCUPIED')).toBe(
      true,
    );
    const [{ count }] = await ctx.dataSource.query(
      `SELECT count(*)::int AS count FROM packages WHERE status = 'STORED'`,
    );
    expect(count).toBe(lockers.length);
  });

  it('respects size constraints under contention: large packages only ever land in large lockers', async () => {
    await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    await createLocker(a.admin, 'M-01', LockerSize.MEDIUM);
    const large = await createLocker(a.admin, 'L-01', LockerSize.LARGE);

    const outcomes = await storeConcurrently(15, LockerSize.LARGE);
    const won = outcomes.filter((o) => o.status === 201);
    expect(won).toHaveLength(1);
    expect(won[0].lockerId).toBe(large.id);
    expect(outcomes.filter((o) => o.status === 409)).toHaveLength(14);
  });

  it('keeps availability consistent when stores and retrievals interleave', async () => {
    const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    const first = await storePackage(a.agent, LockerSize.SMALL, a.customer);

    const [retrieval, ...stores] = await Promise.all([
      retrieve(a.customer, locker.id, first.pickupCode),
      ...Array.from({ length: 10 }, () =>
        a.agent.http.post('/api/packages').send({ size: 'SMALL', customerId: a.customer2.user.id }),
      ),
    ]);

    expect(retrieval.status).toBe(200);
    const won = stores.filter((r) => r.status === 201);
    expect(won.length).toBeLessThanOrEqual(1);
    expect(stores.filter((r) => r.status >= 500)).toHaveLength(0);

    const [{ count }] = await ctx.dataSource.query(
      `SELECT count(*)::int AS count FROM packages WHERE status = 'STORED'`,
    );
    const view = await a.admin.http.get(`/api/lockers/${locker.id}`).expect(200);
    expect(count).toBe(won.length);
    expect(view.body.data.status).toBe(won.length === 1 ? 'OCCUPIED' : 'AVAILABLE');
  });
});
