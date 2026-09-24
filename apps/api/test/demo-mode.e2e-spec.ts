import './demo-mode.env';

import request from 'supertest';

import { User } from '../src/users/user.entity';
import { UserRole } from '../src/users/user-role';
import { createTestApp, resetDatabase, TestContext } from './utils/test-app';

describe('Demo mode (e2e) - DEMO_MODE=true', () => {
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

  it('lists active accounts and returns the login code in the request response, then logs in with it', async () => {
    const repo = ctx.dataSource.getRepository(User);
    await repo.save(
      repo.create({
        email: 'admin@demo.local',
        role: UserRole.ADMIN,
        displayName: 'Admin',
        active: true,
      }),
    );
    await repo.save(
      repo.create({
        email: 'gone@demo.local',
        role: UserRole.CUSTOMER,
        displayName: null,
        active: false,
      }),
    );

    const info = await anon().get('/api/auth/demo').expect(200);
    expect(info.body.data).toEqual({
      enabled: true,
      accounts: [{ email: 'admin@demo.local', role: 'ADMIN', displayName: 'Admin' }],
    });

    const req = await anon()
      .post('/api/auth/otp/request')
      .send({ email: 'admin@demo.local' })
      .expect(202);
    expect(req.body.data.demoCode).toMatch(/^\d{6}$/);
    // The email still goes out, with the same code.
    expect(ctx.mailbox.lastCodeTo('admin@demo.local')).toBe(req.body.data.demoCode);

    const http = request.agent(ctx.app.getHttpServer());
    await http
      .post('/api/auth/otp/verify')
      .send({ email: 'admin@demo.local', code: req.body.data.demoCode })
      .expect(200);
    const me = await http.get('/api/auth/me').expect(200);
    expect(me.body.data.role).toBe('ADMIN');
  });

  it('still reveals nothing for unknown or inactive accounts', async () => {
    const res = await anon()
      .post('/api/auth/otp/request')
      .send({ email: 'nobody@demo.local' })
      .expect(202);
    expect(res.body.data).toEqual({ message: expect.any(String) });
  });
});
