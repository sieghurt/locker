import request from 'supertest';

import { User } from '../src/users/user.entity';
import { UserRole } from '../src/users/user-role';
import { createTestApp, loginAs, resetDatabase, seedActors, TestContext } from './utils/test-app';

describe('Auth & users (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.dataSource);
    ctx.mailbox.clear();
  });
  afterAll(() => ctx?.app.close());

  const anon = () => request(ctx.app.getHttpServer());
  const createUser = (email: string, role: UserRole) =>
    ctx.dataSource
      .getRepository(User)
      .save(
        ctx.dataSource.getRepository(User).create({ email, role, active: true, displayName: null }),
      );

  describe('login by one-time code', () => {
    it('emails a code to a known account and answers identically for an unknown one', async () => {
      await createUser('alice@test.local', UserRole.CUSTOMER);

      const known = await anon()
        .post('/api/auth/otp/request')
        .send({ email: 'Alice@Test.local' })
        .expect(202);
      const unknown = await anon()
        .post('/api/auth/otp/request')
        .send({ email: 'nobody@test.local' })
        .expect(202);
      expect(known.body).toEqual(unknown.body);
      expect(known.body.data.demoCode).toBeUndefined();

      const demo = await anon().get('/api/auth/demo').expect(200);
      expect(demo.body.data).toEqual({ enabled: false, accounts: [] });

      expect(ctx.mailbox.messages.map((m) => m.to)).toEqual(['alice@test.local']);
      expect(ctx.mailbox.lastCodeTo('alice@test.local')).toMatch(/^\d{6}$/);
    });

    it('exchanges a valid code for an httpOnly session cookie, once', async () => {
      await createUser('alice@test.local', UserRole.CUSTOMER);
      const http = request.agent(ctx.app.getHttpServer());
      await http.post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      const code = ctx.mailbox.lastCodeTo('alice@test.local');

      const res = await http
        .post('/api/auth/otp/verify')
        .send({ email: 'alice@test.local', code })
        .expect(200);
      expect(res.body.data).toMatchObject({
        email: 'alice@test.local',
        role: 'CUSTOMER',
        active: true,
      });
      const cookie = String(res.headers['set-cookie']);
      expect(cookie).toMatch(/^sid=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);

      const me = await http.get('/api/auth/me').expect(200);
      expect(me.body.data.email).toBe('alice@test.local');

      // Single use.
      const again = await request(ctx.app.getHttpServer())
        .post('/api/auth/otp/verify')
        .send({ email: 'alice@test.local', code })
        .expect(401);
      expect(again.body.error.code).toBe('INVALID_LOGIN_CODE');
    });

    it('rejects wrong codes and burns the code after OTP_MAX_ATTEMPTS (3) guesses', async () => {
      await createUser('alice@test.local', UserRole.CUSTOMER);
      await anon().post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      const code = ctx.mailbox.lastCodeTo('alice@test.local');
      const wrong = code === '000000' ? '000001' : '000000';

      for (let i = 0; i < 3; i++) {
        const res = await anon()
          .post('/api/auth/otp/verify')
          .send({ email: 'alice@test.local', code: wrong })
          .expect(401);
        expect(res.body.error.code).toBe('INVALID_LOGIN_CODE');
      }
      await anon()
        .post('/api/auth/otp/verify')
        .send({ email: 'alice@test.local', code })
        .expect(401);
    });

    it('invalidates earlier codes when a new one is requested, and stops issuing after the per-account limit', async () => {
      await createUser('alice@test.local', UserRole.CUSTOMER);
      await anon().post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      const first = ctx.mailbox.lastCodeTo('alice@test.local');
      await anon().post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      const second = ctx.mailbox.lastCodeTo('alice@test.local');

      await anon()
        .post('/api/auth/otp/verify')
        .send({ email: 'alice@test.local', code: first })
        .expect(401);
      await anon()
        .post('/api/auth/otp/verify')
        .send({ email: 'alice@test.local', code: second })
        .expect(200);

      // OTP_MAX_REQUESTS_PER_10_MIN is 5 in e2e.env.ts: two used above, three more allowed, then silence.
      for (let i = 0; i < 3; i++)
        await anon().post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      const sentBefore = ctx.mailbox.messages.length;
      await anon().post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      expect(ctx.mailbox.messages.length).toBe(sentBefore);
    });

    it('does not let inactive accounts log in', async () => {
      const user = await createUser('alice@test.local', UserRole.CUSTOMER);
      await ctx.dataSource.getRepository(User).update({ id: user.id }, { active: false });
      await anon().post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      expect(ctx.mailbox.messages).toHaveLength(0);
    });

    it('logs out by clearing the cookie', async () => {
      const alice = await loginAs(ctx, 'alice@test.local', UserRole.CUSTOMER);
      await alice.http.get('/api/auth/me').expect(200);
      await alice.http.post('/api/auth/logout').expect(204);
      const res = await alice.http.get('/api/auth/me').expect(401);
      expect(res.body.error.code).toBe('NOT_LOGGED_IN');
    });

    it('rejects a tampered cookie', async () => {
      const alice = await loginAs(ctx, 'alice@test.local', UserRole.CUSTOMER);
      const [body, sig] = alice.cookie.replace('sid=', '').split('.');
      const forged = `sid=${body}.${sig.slice(0, -2)}xx`;
      await anon().get('/api/auth/me').set('Cookie', forged).expect(401);
    });
  });

  it('leaves the health endpoint reachable without a session (container healthchecks)', async () => {
    const res = await anon().get('/api/health').expect(200);
    expect(res.body.data).toMatchObject({ status: 'ok', database: 'up' });
  });

  describe('user management', () => {
    it('lets an admin create users of every role and rejects duplicate emails', async () => {
      const a = await seedActors(ctx);
      for (const role of ['ADMIN', 'AGENT', 'CUSTOMER']) {
        const res = await a.admin.http
          .post('/api/users')
          .send({ email: `${role}@new.local`, role, displayName: role })
          .expect(201);
        expect(res.body.data).toMatchObject({
          email: `${role.toLowerCase()}@new.local`,
          role,
          active: true,
        });
      }
      const dup = await a.admin.http
        .post('/api/users')
        .send({ email: 'agent@new.local', role: 'CUSTOMER' })
        .expect(409);
      expect(dup.body.error.code).toBe('EMAIL_TAKEN');

      const list = await a.admin.http.get('/api/users?role=ADMIN').expect(200);
      expect(list.body.data.items.map((u: { email: string }) => u.email).sort()).toEqual([
        'admin@new.local',
        'admin@test.local',
      ]);
    });

    it('keeps user management admin-only', async () => {
      const a = await seedActors(ctx);
      await a.agent.http.get('/api/users').expect(403);
      await a.customer.http
        .post('/api/users')
        .send({ email: 'x@y.local', role: 'CUSTOMER' })
        .expect(403);
      await a.agent.http
        .patch(`/api/users/${a.customer.user.id}`)
        .send({ active: false })
        .expect(403);
    });

    it('gives agents a masked customer directory, searchable, without full emails', async () => {
      const a = await seedActors(ctx);
      const res = await a.agent.http.get('/api/users/customers?q=ali').expect(200);
      expect(res.body.data.items).toEqual([
        { id: a.customer.user.id, label: 'Alice', maskedEmail: 'al***@test.local' },
      ]);
      expect(JSON.stringify(res.body)).not.toContain('alice@test.local');
      await a.customer.http.get('/api/users/customers').expect(403);
    });

    it('deactivating a user stops new logins but leaves their current session until it expires', async () => {
      const a = await seedActors(ctx);
      await a.admin.http
        .patch(`/api/users/${a.customer.user.id}`)
        .send({ active: false })
        .expect(200);
      ctx.mailbox.clear();
      await anon().post('/api/auth/otp/request').send({ email: 'alice@test.local' }).expect(202);
      expect(ctx.mailbox.messages).toHaveLength(0);

      // Sessions are stateless signed cookies, so the cookie already issued keeps working until it
      // expires. That is the documented trade-off; this test states it rather than implying otherwise.
      await a.customer.http.get('/api/auth/me').expect(200);

      const self = await a.admin.http
        .patch(`/api/users/${a.admin.user.id}`)
        .send({ active: false, role: 'CUSTOMER' })
        .expect(200);
      expect(self.body.data).toMatchObject({ active: true, role: 'ADMIN' });
    });
  });
});
