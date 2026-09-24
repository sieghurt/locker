import { Injectable, Logger } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

import { Clock } from '../common/clock';
import { InvalidLoginCodeError } from '../common/errors/domain.errors';
import { Mailer } from '../mail/mailer';
import { User } from '../users/user.entity';
import { UsersRepository } from '../users/users.repository';
import { OtpPolicy } from './otp.policy';
import { OtpRepository } from './otp.repository';
import { SessionTokenService, SessionUser } from './session-token.service';

/**
 * Passwordless login: a one-time code is emailed to a known, active user; verifying it yields a session.
 * Every response to `requestCode` is identical whether or not the email exists, so the endpoint cannot
 * be used to enumerate accounts.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly otps: OtpRepository,
    private readonly mailer: Mailer,
    private readonly sessions: SessionTokenService,
    private readonly policy: OtpPolicy,
    private readonly clock: Clock,
    private readonly secret: string,
    /** When true the plain code is returned to the caller as well as emailed. Never in production. */
    private readonly demoMode = false,
  ) {
    if (demoMode) {
      this.logger.warn(
        'DEMO_MODE is on: login codes are returned in API responses. Never use in production.',
      );
    }
  }

  get isDemoMode(): boolean {
    return this.demoMode;
  }

  /** Emails a login code. Resolves to the code itself only in demo mode; otherwise always to undefined. */
  async requestCode(rawEmail: string): Promise<string | undefined> {
    const email = rawEmail.trim().toLowerCase();
    const user = await this.users.findByEmail(email);
    if (!user || !user.active) {
      this.logger.warn(
        `Login code requested for unknown or inactive account (*@${email.split('@')[1] ?? '?'})`,
      );
      return undefined;
    }

    const now = this.clock.now();
    const issuedRecently = await this.otps.countIssuedSince(
      user.id,
      new Date(now.getTime() - this.policy.requestWindowMs),
    );
    if (issuedRecently >= this.policy.maxRequestsPerWindow) {
      this.logger.warn(`Login code request limit reached for user ${user.id}`);
      return undefined;
    }

    const code = randomInt(0, 10 ** this.policy.length)
      .toString()
      .padStart(this.policy.length, '0');
    await this.otps.consumeAllOpen(user.id, now);
    await this.otps.create(
      user.id,
      this.hash(code, user.id),
      new Date(now.getTime() + this.policy.ttlMs),
    );

    const minutes = Math.round(this.policy.ttlMs / 60_000);
    await this.mailer.send({
      to: user.email,
      subject: `${code} is your Smart Package Locker login code`,
      text: `Your login code is ${code}. It expires in ${minutes} minutes and can be used once.\n\nIf you did not request it, ignore this email.`,
      html: `<p>Your login code is</p><p style="font-size:28px;letter-spacing:6px;font-family:monospace"><strong>${code}</strong></p><p>It expires in ${minutes} minutes and can be used once.</p><p>If you did not request it, ignore this email.</p>`,
    });
    this.logger.log(`Login code sent to user ${user.id}`);
    return this.demoMode ? code : undefined;
  }

  async verifyCode(
    rawEmail: string,
    code: string,
  ): Promise<{ user: User; token: string; expiresAt: Date }> {
    const email = rawEmail.trim().toLowerCase();
    const now = this.clock.now();
    const user = await this.users.findByEmail(email);
    const open = user && user.active ? await this.otps.findOpen(user.id, now) : null;
    if (!user || !open) throw new InvalidLoginCodeError();

    const expected = Buffer.from(open.codeHash.trim(), 'hex');
    const actual = Buffer.from(this.hash(code, user.id), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      const attempts = open.attempts + 1;
      const burned = attempts >= this.policy.maxAttempts;
      await this.otps.recordAttempt(open.id, attempts, burned ? now : null);
      this.logger.warn(
        `Wrong login code for user ${user.id} (attempt ${attempts}${burned ? ', code invalidated' : ''})`,
      );
      throw new InvalidLoginCodeError();
    }

    await this.otps.consume(open.id, now);
    await this.users.markLoggedIn(user.id, now);
    const session: SessionUser = { id: user.id, role: user.role, email: user.email };
    const { token, expiresAt } = this.sessions.issue(session, now);
    this.logger.log(`User ${user.id} logged in`);
    return { user, token, expiresAt };
  }

  /** Codes are keyed to the user so a code issued to one account cannot be replayed against another. */
  private hash(code: string, userId: string): string {
    return createHmac('sha256', this.secret).update(`${userId}:${code}`).digest('hex');
  }
}
