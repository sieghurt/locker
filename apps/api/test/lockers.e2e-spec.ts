import { LockerSize } from '../src/lockers/locker-size';
import {
  Actors,
  createLocker,
  createTestApp,
  resetDatabase,
  seedActors,
  storePackage,
  TestContext,
} from './utils/test-app';

describe('Lockers (e2e) - Level 1: create and view lockers', () => {
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

  it('lets an admin create lockers of each size, reported AVAILABLE', async () => {
    const res = await a.admin.http
      .post('/api/lockers')
      .send({ label: 'A-01', size: 'SMALL' })
      .expect(201);
    expect(res.body).toEqual({
      success: true,
      data: expect.objectContaining({
        id: expect.any(String),
        label: 'A-01',
        size: 'SMALL',
        status: 'AVAILABLE',
        currentPackage: null,
      }),
    });
  });

  it('refuses locker creation to agents and customers, and to anonymous callers', async () => {
    const forbidden = await a.agent.http
      .post('/api/lockers')
      .send({ label: 'A-01', size: 'SMALL' })
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
    await a.customer.http.post('/api/lockers').send({ label: 'A-01', size: 'SMALL' }).expect(403);
    const anon = await (
      await import('supertest')
    )
      .default(ctx.app.getHttpServer())
      .get('/api/lockers')
      .expect(401);
    expect(anon.body.error.code).toBe('NOT_LOGGED_IN');
  });

  it('rejects an unknown size and unknown fields with a VALIDATION_ERROR envelope', async () => {
    const res = await a.admin.http
      .post('/api/lockers')
      .send({ label: 'A-01', size: 'HUGE', extra: true })
      .expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.stringContaining('size'), expect.stringContaining('extra')]),
    );
  });

  it('rejects a duplicate label with LOCKER_LABEL_TAKEN', async () => {
    await createLocker(a.admin, 'A-01', LockerSize.SMALL);
    const res = await a.admin.http
      .post('/api/lockers')
      .send({ label: 'A-01', size: 'LARGE' })
      .expect(409);
    expect(res.body.error.code).toBe('LOCKER_LABEL_TAKEN');
  });

  it('lists lockers with availability and the customer label of the package inside (any logged-in role)', async () => {
    const small = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    await createLocker(a.admin, 'M-01', LockerSize.MEDIUM);
    const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);

    // Staff see who the package belongs to; the customer view is covered by its own test below.
    const res = await a.agent.http.get('/api/lockers').expect(200);
    const { items, total } = res.body.data;
    expect(total).toBe(2);
    expect(items.map((l: { label: string; status: string }) => [l.label, l.status])).toEqual([
      ['M-01', 'AVAILABLE'],
      ['S-01', 'OCCUPIED'],
    ]);
    const occupied = items.find((l: { id: string }) => l.id === small.id);
    expect(occupied.currentPackage).toEqual({
      id: stored.packageId,
      size: 'SMALL',
      customerLabel: 'Alice',
      storedAt: expect.any(String),
    });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(stored.pickupCode);
    expect(body).not.toContain('alice@test.local');
  });

  it('tells a customer a locker is occupied without saying whose package it is', async () => {
    const small = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    await storePackage(a.agent, LockerSize.SMALL, a.customer2);

    const asCustomer = await a.customer.http.get(`/api/lockers/${small.id}`).expect(200);
    expect(asCustomer.body.data.status).toBe('OCCUPIED');
    expect(asCustomer.body.data.currentPackage.customerLabel).toBeUndefined();
    expect(JSON.stringify(asCustomer.body)).not.toContain('Bob');

    for (const staff of [a.agent, a.admin]) {
      const res = await staff.http.get(`/api/lockers/${small.id}`).expect(200);
      expect(res.body.data.currentPackage.customerLabel).toBe('Bob');
    }

    const listAsCustomer = await a.customer.http.get('/api/lockers').expect(200);
    expect(JSON.stringify(listAsCustomer.body)).not.toContain('Bob');
  });

  it('filters by status and size and paginates', async () => {
    await createLocker(a.admin, 'S-01', LockerSize.SMALL);
    await createLocker(a.admin, 'S-02', LockerSize.SMALL);
    await createLocker(a.admin, 'L-01', LockerSize.LARGE);
    await storePackage(a.agent, LockerSize.SMALL, a.customer);

    const available = await a.agent.http.get('/api/lockers?status=AVAILABLE').expect(200);
    expect(available.body.data.items.map((l: { label: string }) => l.label)).toEqual([
      'L-01',
      'S-02',
    ]);

    const smalls = await a.agent.http.get('/api/lockers?size=SMALL&limit=1&offset=1').expect(200);
    expect(smalls.body.data).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(smalls.body.data.items).toHaveLength(1);

    await a.agent.http.get('/api/lockers?limit=0').expect(400);
  });

  it('returns 404 LOCKER_NOT_FOUND for an unknown id and 400 for a malformed one', async () => {
    const res = await a.admin.http
      .get('/api/lockers/00000000-0000-4000-8000-000000000000')
      .expect(404);
    expect(res.body.error.code).toBe('LOCKER_NOT_FOUND');
    const malformed = await a.admin.http.get('/api/lockers/not-a-uuid').expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    expect(malformed.body.error.details).toEqual([expect.stringContaining('uuid')]);
  });
});
