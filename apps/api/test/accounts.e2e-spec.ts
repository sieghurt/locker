import request from 'supertest';

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

describe('Customer accounts (e2e) - balances and transaction history', () => {
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

  const backdate = (packageId: string, days: number) =>
    ctx.dataSource
      .getRepository(Package)
      .update({ id: packageId }, { storedAt: new Date(Date.now() - days * DAY - 60_000) });

  /** Stores a package, ages it, and collects it: the flow that puts a charge in the ledger. */
  async function collectAfter(days: number, customer = a.customer, label = 'S-01') {
    await createLocker(a.admin, label, LockerSize.SMALL);
    // Collect from wherever it landed: allocation may reuse a locker freed by an earlier pickup.
    const stored = await storePackage(a.agent, LockerSize.SMALL, customer);
    if (days > 0) await backdate(stored.packageId, days);
    await retrieve(customer, stored.lockerId, stored.pickupCode).expect(200);
    return stored;
  }

  it('starts every customer at a zero balance with no transactions', async () => {
    const res = await a.customer.http.get('/api/accounts/me').expect(200);
    expect(res.body.data).toEqual({
      customerId: a.customer.user.id,
      customerLabel: 'Alice',
      currency: 'UNITS',
      balance: 0,
      charged: 0,
      paid: 0,
      transactions: 0,
    });

    const history = await a.customer.http.get('/api/accounts/me/transactions').expect(200);
    expect(history.body.data).toMatchObject({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('records a charge when a package is collected, and shows it in the history', async () => {
    const stored = await collectAfter(6); // 7 started days -> 90

    const account = await a.customer.http.get('/api/accounts/me').expect(200);
    expect(account.body.data).toMatchObject({ balance: 90, charged: 90, paid: 0, transactions: 1 });

    const history = await a.customer.http.get('/api/accounts/me/transactions').expect(200);
    expect(history.body.data.total).toBe(1);
    expect(history.body.data.items[0]).toMatchObject({
      type: 'CHARGE',
      amount: 90,
      currency: 'UNITS',
      description: expect.stringMatching(/^Storage for 7 day\(s\) in locker S-0\d$/),
      packageId: stored.packageId,
      occurredAt: expect.any(String),
    });
  });

  it('settles the balance when an admin records a payment, and keeps both rows in the history', async () => {
    await collectAfter(6);

    const payment = await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/payments`)
      .send({ amount: 40, note: 'Cash at the kiosk' })
      .expect(201);
    expect(payment.body.data).toMatchObject({
      type: 'PAYMENT',
      amount: -40,
      description: 'Cash at the kiosk',
    });

    const account = await a.customer.http.get('/api/accounts/me').expect(200);
    expect(account.body.data).toMatchObject({
      balance: 50,
      charged: 90,
      paid: 40,
      transactions: 2,
    });

    const history = await a.customer.http.get('/api/accounts/me/transactions').expect(200);
    expect(
      history.body.data.items.map((t: { type: string; amount: number }) => [t.type, t.amount]),
    ).toEqual([
      ['PAYMENT', -40],
      ['CHARGE', 90],
    ]);
  });

  it('keeps each customer to their own ledger', async () => {
    await collectAfter(6, a.customer, 'S-01');
    await collectAfter(0, a.customer2, 'S-02'); // same day -> 10

    const alice = await a.customer.http.get('/api/accounts/me').expect(200);
    const bob = await a.customer2.http.get('/api/accounts/me').expect(200);
    expect(alice.body.data.balance).toBe(90);
    expect(bob.body.data.balance).toBe(10);

    const bobHistory = await a.customer2.http.get('/api/accounts/me/transactions').expect(200);
    expect(bobHistory.body.data.items).toHaveLength(1);
    expect(bobHistory.body.data.items[0].amount).toBe(10);
  });

  it('gives an admin every customer balance, one customer, and their history', async () => {
    await collectAfter(6);

    const list = await a.admin.http.get('/api/accounts').expect(200);
    expect(list.body.data.total).toBe(2);
    expect(list.body.data.totalBalance).toBe(90);
    const labels = list.body.data.items.map((item: { customerLabel: string; balance: number }) => [
      item.customerLabel,
      item.balance,
    ]);
    expect(labels).toEqual(
      expect.arrayContaining([
        ['Alice', 90],
        ['Bob', 0],
      ]),
    );

    const one = await a.admin.http.get(`/api/accounts/${a.customer.user.id}`).expect(200);
    expect(one.body.data).toMatchObject({ balance: 90, charged: 90 });

    const history = await a.admin.http
      .get(`/api/accounts/${a.customer.user.id}/transactions`)
      .expect(200);
    expect(history.body.data.account).toMatchObject({ customerLabel: 'Alice', balance: 90 });
    expect(history.body.data.items[0]).toMatchObject({ type: 'CHARGE', amount: 90 });
  });

  it('corrects a mistake with an adjustment instead of rewriting history', async () => {
    await collectAfter(6); // charge 90
    await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/payments`)
      .send({ amount: 40 })
      .expect(201);
    // The same payment recorded twice by mistake.
    await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/payments`)
      .send({ amount: 40 })
      .expect(201);

    const overpaid = await a.customer.http.get('/api/accounts/me').expect(200);
    expect(overpaid.body.data).toMatchObject({ balance: 10, charged: 90, paid: 80 });

    const fix = await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/adjustments`)
      .send({ amount: 40, reason: 'Payment recorded twice on 24 Sep' })
      .expect(201);
    expect(fix.body.data).toMatchObject({ type: 'ADJUSTMENT', amount: 40 });

    const corrected = await a.customer.http.get('/api/accounts/me').expect(200);
    // The correction moves the balance without pretending the customer was charged or paid more.
    expect(corrected.body.data).toMatchObject({
      balance: 50,
      charged: 90,
      paid: 80,
      transactions: 4,
    });

    const history = await a.customer.http.get('/api/accounts/me/transactions').expect(200);
    expect(history.body.data.items[0]).toMatchObject({
      type: 'ADJUSTMENT',
      description: 'Payment recorded twice on 24 Sep',
    });

    await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/adjustments`)
      .send({ amount: 0, reason: 'x' })
      .expect(400);
    await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/adjustments`)
      .send({ amount: 5 })
      .expect(400);
    await a.agent.http
      .post(`/api/accounts/${a.customer.user.id}/adjustments`)
      .send({ amount: 5, reason: 'no' })
      .expect(403);
  });

  it('reports the station total across every customer, not just the page shown', async () => {
    await collectAfter(6, a.customer, 'S-01'); // 90
    await collectAfter(0, a.customer2, 'S-02'); // 10

    const firstPageOnly = await a.admin.http.get('/api/accounts?limit=1').expect(200);
    expect(firstPageOnly.body.data.items).toHaveLength(1);
    expect(firstPageOnly.body.data.total).toBe(2);
    // The page holds one customer; the figure is what the whole station is owed.
    expect(firstPageOnly.body.data.totalBalance).toBe(100);
  });

  it('rejects a payment larger than the ledger column can hold', async () => {
    const res = await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/payments`)
      .send({ amount: 99_999_999_999 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('keeps other people out of the ledger', async () => {
    await a.agent.http.get('/api/accounts').expect(403);
    await a.customer.http.get('/api/accounts').expect(403);
    await a.customer.http.get(`/api/accounts/${a.customer2.user.id}`).expect(403);
    await a.customer.http.get(`/api/accounts/${a.customer2.user.id}/transactions`).expect(403);
    await a.agent.http
      .post(`/api/accounts/${a.customer.user.id}/payments`)
      .send({ amount: 10 })
      .expect(403);
    await request(ctx.app.getHttpServer()).get('/api/accounts/me').expect(401);
  });

  it('validates payments and the account they are for', async () => {
    const zero = await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/payments`)
      .send({ amount: 0 })
      .expect(400);
    expect(zero.body.error.code).toBe('VALIDATION_ERROR');
    await a.admin.http
      .post(`/api/accounts/${a.customer.user.id}/payments`)
      .send({ amount: 1.234 })
      .expect(400);
    await a.admin.http.post(`/api/accounts/${a.customer.user.id}/payments`).send({}).expect(400);

    // An agent account has no ledger.
    const notCustomer = await a.admin.http
      .post(`/api/accounts/${a.agent.user.id}/payments`)
      .send({ amount: 10 })
      .expect(404);
    expect(notCustomer.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('paginates a longer history, newest first', async () => {
    await collectAfter(6);
    for (const amount of [10, 20, 30]) {
      await a.admin.http
        .post(`/api/accounts/${a.customer.user.id}/payments`)
        .send({ amount })
        .expect(201);
    }

    const firstPage = await a.customer.http
      .get('/api/accounts/me/transactions?limit=2')
      .expect(200);
    expect(firstPage.body.data).toMatchObject({ total: 4, limit: 2, offset: 0 });
    expect(firstPage.body.data.items).toHaveLength(2);

    const secondPage = await a.customer.http
      .get('/api/accounts/me/transactions?limit=2&offset=2')
      .expect(200);
    expect(secondPage.body.data.items).toHaveLength(2);
    expect(secondPage.body.data.items.at(-1)).toMatchObject({ type: 'CHARGE' });

    const account = await a.customer.http.get('/api/accounts/me').expect(200);
    expect(account.body.data).toMatchObject({
      balance: 30,
      charged: 90,
      paid: 60,
      transactions: 4,
    });
  });
});
