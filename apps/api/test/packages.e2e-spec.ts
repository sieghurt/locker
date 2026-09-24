import { LockerSize } from '../src/lockers/locker-size';
import { Package } from '../src/packages/package.entity';
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

const DAY = 24 * 60 * 60 * 1000;

describe('Packages (e2e)', () => {
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

  describe('Level 1: storing a package', () => {
    it('stores in the smallest available locker that fits, returns the code, and emails it to the customer', async () => {
      const large = await createLocker(a.admin, 'L-01', LockerSize.LARGE);
      const small = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      await createLocker(a.admin, 'M-01', LockerSize.MEDIUM);

      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);

      expect(stored).toMatchObject({
        packageId: expect.any(String),
        lockerId: small.id,
        lockerLabel: 'S-01',
        lockerSize: 'SMALL',
        packageSize: 'SMALL',
        storedAt: expect.any(String),
        customer: { id: a.customer.user.id, label: 'Alice' },
        notified: true,
      });
      expect(stored.lockerId).not.toBe(large.id);
      expect(stored.pickupCode).toMatch(/^\d{6}$/); // the helper read it from Alice's email

      // The agent's own response carries no code; the customer's email does.
      const raw = await a.agent.http
        .post('/api/packages')
        .send({ size: 'MEDIUM', customerId: a.customer.user.id })
        .expect(201);
      expect(raw.body.data.pickupCode).toBeUndefined();
      const mail = ctx.mailbox.lastTo('alice@test.local');
      expect(mail?.subject).toContain('M-01');
      expect(mail?.text).toMatch(/Pickup code: \d{6}/);
    });

    it('lets an admin read the code waiting in a locker; agents and customers cannot', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);

      const res = await a.admin.http.get(`/api/lockers/${locker.id}/pickup-code`).expect(200);
      expect(res.body.data).toEqual({
        lockerLabel: 'S-01',
        customerLabel: 'Alice',
        pickupCode: stored.pickupCode,
      });
      await a.agent.http.get(`/api/lockers/${locker.id}/pickup-code`).expect(403);
      await a.customer.http.get(`/api/lockers/${locker.id}/pickup-code`).expect(403);

      // Once collected there is nothing to reveal any more.
      await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
      const gone = await a.admin.http.get(`/api/lockers/${locker.id}/pickup-code`).expect(409);
      expect(gone.body.error.code).toBe('LOCKER_EMPTY');
      const [{ enc }] = await ctx.dataSource.query(
        `SELECT pickup_code_encrypted AS enc FROM packages WHERE id = $1`,
        [stored.packageId],
      );
      expect(enc).toBeNull();
    });

    it('includes the pickup code in the response only for admins', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const res = await a.admin.http
        .post('/api/packages')
        .send({ size: 'SMALL', customerId: a.customer.user.id })
        .expect(201);
      expect(res.body.data.pickupCode).toMatch(/^\d{6}$/);
      expect(ctx.mailbox.lastCodeTo('alice@test.local')).toBe(res.body.data.pickupCode);
    });

    it('falls back to a bigger locker when no exact-size locker is free', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const medium = await createLocker(a.admin, 'M-01', LockerSize.MEDIUM);
      const large = await createLocker(a.admin, 'L-01', LockerSize.LARGE);

      const first = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const second = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const third = await storePackage(a.agent, LockerSize.SMALL, a.customer2);

      expect(first.lockerLabel).toBe('S-01');
      expect(second.lockerId).toBe(medium.id);
      expect(third.lockerId).toBe(large.id);
    });

    it('never puts a package into a locker that is too small', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      await createLocker(a.admin, 'M-01', LockerSize.MEDIUM);

      const res = await a.agent.http
        .post('/api/packages')
        .send({ size: 'LARGE', customerId: a.customer.user.id })
        .expect(409);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'NO_SUITABLE_LOCKER',
          message: expect.stringContaining('cannot be stored'),
          details: { packageSize: 'LARGE' },
        },
      });
    });

    it('reports that the package cannot be stored when everything is full', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const res = await a.agent.http
        .post('/api/packages')
        .send({ size: 'SMALL', customerId: a.customer.user.id })
        .expect(409);
      expect(res.body.error.code).toBe('NO_SUITABLE_LOCKER');
    });

    it('only stores for active customer accounts', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const notCustomer = await a.agent.http
        .post('/api/packages')
        .send({ size: 'SMALL', customerId: a.agent.user.id })
        .expect(422);
      expect(notCustomer.body.error.code).toBe('CUSTOMER_NOT_FOUND');

      await a.admin.http
        .patch(`/api/users/${a.customer2.user.id}`)
        .send({ active: false })
        .expect(200);
      const inactive = await a.agent.http
        .post('/api/packages')
        .send({ size: 'SMALL', customerId: a.customer2.user.id })
        .expect(422);
      expect(inactive.body.error.code).toBe('CUSTOMER_NOT_FOUND');
    });

    it('is an agent/admin action: customers cannot store', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const res = await a.customer.http
        .post('/api/packages')
        .send({ size: 'SMALL', customerId: a.customer.user.id })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('validates the request body', async () => {
      const res = await a.agent.http.post('/api/packages').send({ size: 'SMALL' }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('issues distinct pickup codes to concurrently stored packages', async () => {
      for (let i = 1; i <= 5; i++) await createLocker(a.admin, `S-0${i}`, LockerSize.SMALL);
      const codes = await Promise.all(
        Array.from({ length: 5 }, () => storePackage(a.agent, LockerSize.SMALL, a.customer)),
      );
      expect(new Set(codes.map((c) => c.pickupCode)).size).toBe(5);
    });
  });

  describe('Level 2: retrieving a package', () => {
    it('opens the locker, removes the package and frees the locker', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);

      const res = await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
      expect(res.body.data).toMatchObject({
        packageId: stored.packageId,
        lockerId: locker.id,
        lockerLabel: 'S-01',
        lockerOpened: true,
        storageCharge: expect.objectContaining({ currency: 'UNITS' }),
      });

      const view = await a.agent.http.get(`/api/lockers/${locker.id}`).expect(200);
      expect(view.body.data).toMatchObject({ status: 'AVAILABLE', currentPackage: null });

      const pkg = await a.customer.http.get(`/api/packages/${stored.packageId}`).expect(200);
      expect(pkg.body.data).toMatchObject({ status: 'RETRIEVED', retrievedAt: expect.any(String) });

      const next = await storePackage(a.agent, LockerSize.SMALL, a.customer2);
      expect(next.lockerId).toBe(locker.id);
    });

    it('lets a customer see only their own packages', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      await createLocker(a.admin, 'S-02', LockerSize.SMALL);
      const mine = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const theirs = await storePackage(a.agent, LockerSize.SMALL, a.customer2);

      const list = await a.customer.http.get('/api/packages/mine').expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([mine.packageId]);
      expect(JSON.stringify(list.body)).not.toContain(mine.pickupCode);

      const hidden = await a.customer.http.get(`/api/packages/${theirs.packageId}`).expect(404);
      expect(hidden.body.error.code).toBe('PACKAGE_NOT_FOUND');
    });

    it("refuses a customer collecting someone else's package, even with the right code", async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);

      const res = await retrieve(a.customer2, locker.id, stored.pickupCode).expect(403);
      expect(res.body.error.code).toBe('NOT_YOUR_PACKAGE');
      const view = await a.agent.http.get(`/api/lockers/${locker.id}`).expect(200);
      expect(view.body.data.status).toBe('OCCUPIED');
    });

    it('lets an admin collect on behalf of a customer; agents never collect', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      await retrieve(a.agent, locker.id, stored.pickupCode).expect(403);
      await retrieve(a.admin, locker.id, stored.pickupCode).expect(200);
    });

    it('rejects a wrong pickup code and keeps the package in the locker', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const wrong = stored.pickupCode === '000000' ? '000001' : '000000';

      const res = await retrieve(a.customer, locker.id, wrong).expect(403);
      expect(res.body.error.code).toBe('INVALID_PICKUP_CODE');
      const view = await a.customer.http.get(`/api/lockers/${locker.id}`).expect(200);
      expect(view.body.data.status).toBe('OCCUPIED');
    });

    it('rejects retrieval from an empty locker and a second retrieval with the same code', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const empty = await retrieve(a.customer, locker.id, '123456').expect(409);
      expect(empty.body.error.code).toBe('LOCKER_EMPTY');

      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
      const again = await retrieve(a.customer, locker.id, stored.pickupCode).expect(409);
      expect(again.body.error.code).toBe('LOCKER_EMPTY');
    });

    it('rejects an unknown locker and malformed input', async () => {
      const notFound = await retrieve(
        a.customer,
        '00000000-0000-4000-8000-000000000000',
        '123456',
      ).expect(404);
      expect(notFound.body.error.code).toBe('LOCKER_NOT_FOUND');
      const bad = await retrieve(a.customer, 'not-a-uuid', 'abc').expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('locks the locker after too many wrong codes, then refuses even the right one', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const wrong = stored.pickupCode === '000000' ? '000001' : '000000';

      await retrieve(a.customer, locker.id, wrong).expect(403);
      await retrieve(a.customer, locker.id, wrong).expect(403);
      const third = await retrieve(a.customer, locker.id, wrong).expect(423);
      expect(third.body.error).toMatchObject({
        code: 'PICKUP_LOCKED',
        details: { lockerId: locker.id, lockedUntil: expect.any(String) },
      });

      await retrieve(a.customer, locker.id, stored.pickupCode).expect(423);
      await ctx.dataSource
        .getRepository(Package)
        .update({ id: stored.packageId }, { pickupLockedUntil: new Date(Date.now() - 1000) });
      await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
    });
  });

  describe('Level 3: storage charges', () => {
    const backdate = (packageId: string, days: number) =>
      ctx.dataSource
        .getRepository(Package)
        .update({ id: packageId }, { storedAt: new Date(Date.now() - days * DAY - 60_000) });

    it('charges one started day for an immediate pickup', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const res = await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
      expect(res.body.data.storageCharge).toMatchObject({
        totalDays: 1,
        chargedDays: 1,
        amount: 10,
        breakdown: [{ tier: 1, days: 1, ratePerDay: 10, amount: 10 }],
      });
    });

    it('applies the tiered rule: X/day for 5 days, 2X for the next 5, 3X after', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      await backdate(stored.packageId, 11);

      const res = await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
      expect(res.body.data.storageCharge).toEqual({
        currency: 'UNITS',
        totalDays: 12,
        freeDays: 0,
        chargedDays: 12,
        amount: 210,
        breakdown: [
          { tier: 1, days: 5, ratePerDay: 10, amount: 50 },
          { tier: 2, days: 5, ratePerDay: 20, amount: 100 },
          { tier: 3, days: 2, ratePerDay: 30, amount: 60 },
        ],
      });
      const pkg = await a.customer.http.get(`/api/packages/${stored.packageId}`).expect(200);
      expect(pkg.body.data).toMatchObject({
        storageCharge: 210,
        chargedDays: 12,
        status: 'RETRIEVED',
      });
    });

    it('shows a customer what each package owes, before and after collection', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      await backdate(stored.packageId, 6); // 7 started days

      const waiting = await a.customer.http.get('/api/packages/mine').expect(200);
      expect(waiting.body.data[0]).toMatchObject({
        status: 'STORED',
        storageCharge: null,
        charge: { currency: 'UNITS', totalDays: 7, chargedDays: 7, amount: 90 },
      });
      expect(JSON.stringify(waiting.body)).not.toContain(stored.pickupCode);

      await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
      const collected = await a.customer.http.get('/api/packages/mine').expect(200);
      expect(collected.body.data[0]).toMatchObject({
        status: 'RETRIEVED',
        storageCharge: 90,
        chargedDays: 7,
        charge: { amount: 90, totalDays: 7 },
      });
    });

    it('shows admins what a waiting package owes on the locker board, and hides it from others', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      await backdate(stored.packageId, 2); // 3 started days

      const asAdmin = await a.admin.http.get(`/api/lockers/${locker.id}`).expect(200);
      expect(asAdmin.body.data.currentPackage.accruedCharge).toEqual({
        amount: 30,
        chargedDays: 3,
        currency: 'UNITS',
      });

      for (const who of [a.agent, a.customer]) {
        const res = await who.http.get(`/api/lockers/${locker.id}`).expect(200);
        expect(res.body.data.currentPackage.accruedCharge).toBeUndefined();
      }
    });

    it('totals outstanding and collected charges for an admin only', async () => {
      await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      await createLocker(a.admin, 'S-02', LockerSize.SMALL);

      const empty = await a.admin.http.get('/api/packages/charges').expect(200);
      expect(empty.body.data).toEqual({
        currency: 'UNITS',
        outstanding: { packages: 0, amount: 0 },
        collected: { packages: 0, amount: 0 },
      });

      const first = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      const second = await storePackage(a.agent, LockerSize.SMALL, a.customer2);
      await backdate(second.packageId, 6); // 7 started days -> 90

      const waiting = await a.admin.http.get('/api/packages/charges').expect(200);
      expect(waiting.body.data).toMatchObject({
        outstanding: { packages: 2, amount: 100 }, // 10 for the fresh one, 90 for the older
        collected: { packages: 0, amount: 0 },
      });

      await retrieve(a.customer, first.lockerId, first.pickupCode).expect(200);
      const afterPickup = await a.admin.http.get('/api/packages/charges').expect(200);
      expect(afterPickup.body.data).toMatchObject({
        outstanding: { packages: 1, amount: 90 },
        collected: { packages: 1, amount: 10 },
      });

      await a.agent.http.get('/api/packages/charges').expect(403);
      await a.customer.http.get('/api/packages/charges').expect(403);
    });

    it('charges the second tier from day six', async () => {
      const locker = await createLocker(a.admin, 'S-01', LockerSize.SMALL);
      const stored = await storePackage(a.agent, LockerSize.SMALL, a.customer);
      await backdate(stored.packageId, 6);
      const res = await retrieve(a.customer, locker.id, stored.pickupCode).expect(200);
      expect(res.body.data.storageCharge).toMatchObject({ totalDays: 7, amount: 90 });
    });
  });
});
