import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { DataSource } from 'typeorm';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { LockerSize } from '../../src/lockers/locker-size';
import { MailMessage, Mailer } from '../../src/mail/mailer';
import { User } from '../../src/users/user.entity';
import { UserRole } from '../../src/users/user-role';

/** Captures outgoing email so tests can read login codes and pickup codes exactly like a user would. */
export class TestMailbox extends Mailer {
  readonly messages: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.messages.push(message);
    await Promise.resolve();
  }

  /** Newest message to `to`, or undefined. */
  lastTo(to: string): MailMessage | undefined {
    return [...this.messages].reverse().find((m) => m.to === to.toLowerCase());
  }

  /** The first 4-10 digit run in the newest message to `to`: a login code or a pickup code. */
  lastCodeTo(to: string): string {
    const message = this.lastTo(to);
    const code = message
      ? /\b\d{4,10}\b/.exec(message.subject + '\n' + message.text)?.[0]
      : undefined;
    if (!code) throw new Error(`No code emailed to ${to}`);
    return code;
  }

  clear(): void {
    this.messages.length = 0;
  }
}

export interface TestContext {
  app: INestApplication;
  dataSource: DataSource;
  mailbox: TestMailbox;
  baseUrl: string;
}

/**
 * Boots the real application (same pipes, filters, guards as main.ts) against a real Postgres
 * configured by test/e2e.env.ts, with outgoing email captured in memory.
 */
export async function createTestApp(): Promise<TestContext> {
  const mailbox = new TestMailbox();
  currentMailbox = mailbox;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Mailer)
    .useValue(mailbox)
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { trustProxy: true });
  // Listen on an ephemeral port: supertest would otherwise start and stop the server per request,
  // which drops in-flight connections when many requests run concurrently.
  await app.listen(0);
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { app, dataSource: app.get(DataSource), mailbox, baseUrl };
}

export async function resetDatabase(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "customer_transactions", "packages", "otp_codes", "lockers", "users" RESTART IDENTITY CASCADE',
  );
}

/** Session for one user: a supertest agent that keeps the cookie, plus the raw cookie for fetch(). */
export interface Session {
  http: TestAgent;
  cookie: string;
  user: User;
}

/** Creates the account directly (there is no self sign-up) and logs it in through the real OTP flow. */
export async function loginAs(
  ctx: TestContext,
  email: string,
  role: UserRole,
  displayName?: string,
): Promise<Session> {
  const repo = ctx.dataSource.getRepository(User);
  const user =
    (await repo.findOne({ where: { email } })) ??
    (await repo.save(repo.create({ email, role, displayName: displayName ?? null, active: true })));

  const http = request.agent(ctx.app.getHttpServer());
  await http.post('/api/auth/otp/request').send({ email }).expect(202);
  const code = ctx.mailbox.lastCodeTo(email);
  const res = await http.post('/api/auth/otp/verify').send({ email, code }).expect(200);
  const setCookie = res.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
    .map((c: string) => c.split(';')[0])
    .join('; ');
  return { http, cookie, user };
}

export interface Actors {
  admin: Session;
  agent: Session;
  customer: Session;
  customer2: Session;
}

/** The usual cast: one of each role plus a second customer for ownership checks. */
export async function seedActors(ctx: TestContext): Promise<Actors> {
  const admin = await loginAs(ctx, 'admin@test.local', UserRole.ADMIN, 'Admin');
  const agent = await loginAs(ctx, 'agent@test.local', UserRole.AGENT, 'Agent');
  const customer = await loginAs(ctx, 'alice@test.local', UserRole.CUSTOMER, 'Alice');
  const customer2 = await loginAs(ctx, 'bob@test.local', UserRole.CUSTOMER, 'Bob');
  ctx.mailbox.clear();
  return { admin, agent, customer, customer2 };
}

export interface LockerFixture {
  id: string;
  label: string;
  size: LockerSize;
}

export async function createLocker(
  admin: Session,
  label: string,
  size: LockerSize,
): Promise<LockerFixture> {
  const res = await admin.http.post('/api/lockers').send({ label, size }).expect(201);
  return res.body.data as LockerFixture;
}

export interface StoredFixture {
  packageId: string;
  lockerId: string;
  lockerLabel: string;
  lockerSize: LockerSize;
  packageSize: LockerSize;
  /** From the response for admins; for agents, read from the customer's email as the customer would. */
  pickupCode: string;
  storedAt: string;
  customer: { id: string; label: string };
  notified: boolean;
}

/** The mailbox of the most recently created test app, so helpers can read emailed codes without plumbing. */
let currentMailbox: TestMailbox | undefined;

export async function storePackage(
  agent: Session,
  size: LockerSize,
  customer: Session,
): Promise<StoredFixture> {
  const res = await agent.http
    .post('/api/packages')
    .send({ size, customerId: customer.user.id })
    .expect(201);
  const data = res.body.data as Omit<StoredFixture, 'pickupCode'> & { pickupCode?: string };
  if (data.pickupCode) return data as StoredFixture;
  if (!currentMailbox) throw new Error('storePackage: no pickup code in response and no mailbox');
  const mail = [...currentMailbox.messages]
    .reverse()
    .find((m) => m.to === customer.user.email && m.subject.includes(data.lockerLabel));
  const code = mail ? /Pickup code: (\d{4,10})/.exec(mail.text)?.[1] : undefined;
  if (!code) {
    throw new Error(
      `storePackage: no pickup code emailed to ${customer.user.email} for ${data.lockerLabel}`,
    );
  }
  return { ...data, pickupCode: code };
}

export const retrieve = (who: Session, lockerId: string, pickupCode: string) =>
  who.http.post('/api/packages/retrieve').send({ lockerId, pickupCode });
