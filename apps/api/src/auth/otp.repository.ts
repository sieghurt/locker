import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';

import { OtpCode } from './otp-code.entity';

@Injectable()
export class OtpRepository {
  constructor(@InjectRepository(OtpCode) private readonly codes: Repository<OtpCode>) {}

  async create(userId: string, codeHash: string, expiresAt: Date): Promise<OtpCode> {
    return this.codes.save(
      this.codes.create({ userId, codeHash, expiresAt, consumedAt: null, attempts: 0 }),
    );
  }

  /** Any earlier unused codes stop working once a new one is issued. */
  async consumeAllOpen(userId: string, at: Date): Promise<void> {
    await this.codes.update({ userId, consumedAt: IsNull() }, { consumedAt: at });
  }

  async findOpen(userId: string, now: Date): Promise<OtpCode | null> {
    return this.codes.findOne({
      where: { userId, consumedAt: IsNull(), expiresAt: MoreThan(now) },
      order: { createdAt: 'DESC' },
    });
  }

  async countIssuedSince(userId: string, since: Date): Promise<number> {
    return this.codes.count({ where: { userId, createdAt: MoreThan(since) } });
  }

  async recordAttempt(id: string, attempts: number, consumedAt: Date | null): Promise<void> {
    await this.codes.update({ id }, { attempts, consumedAt });
  }

  async consume(id: string, at: Date): Promise<void> {
    await this.codes.update({ id }, { consumedAt: at });
  }
}
