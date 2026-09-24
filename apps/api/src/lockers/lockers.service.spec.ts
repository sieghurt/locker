import { QueryFailedError } from 'typeorm';

import { LockerLabelTakenError, LockerNotFoundError } from '../common/errors/domain.errors';
import { LockerSize } from './locker-size';
import { LockersRepository } from './lockers.repository';
import { LockerEventsService } from './locker-events.service';
import { TieredPricingStrategy } from '../pricing/tiered-pricing.strategy';
import { UsersService } from '../users/users.service';
import { LockersService } from './lockers.service';

describe('LockersService', () => {
  let repository: jest.Mocked<Pick<LockersRepository, 'insert' | 'findByIdWithCurrentPackage'>>;
  let service: LockersService;

  beforeEach(() => {
    repository = { insert: jest.fn(), findByIdWithCurrentPackage: jest.fn() };
    service = new LockersService(
      repository as unknown as LockersRepository,
      new LockerEventsService(),
      { labelsFor: jest.fn().mockResolvedValue(new Map()) } as unknown as UsersService,
      new TieredPricingStrategy({
        ratePerDay: 10,
        tiers: [{ days: null, multiplier: 1 }],
        freeDays: 0,
        currency: 'UNITS',
      }),
      { now: () => new Date('2026-03-10T12:00:00.000Z') },
    );
  });

  it('translates a duplicate label into LOCKER_LABEL_TAKEN', async () => {
    repository.insert.mockRejectedValue(
      new QueryFailedError(
        'INSERT',
        [],
        Object.assign(new Error('dup'), { code: '23505', constraint: 'uq_lockers_label' }),
      ),
    );
    await expect(service.create({ label: 'A-01', size: LockerSize.SMALL })).rejects.toBeInstanceOf(
      LockerLabelTakenError,
    );
  });

  it('lets unrelated database errors through unchanged', async () => {
    repository.insert.mockRejectedValue(new Error('connection lost'));
    await expect(service.create({ label: 'A-01', size: LockerSize.SMALL })).rejects.toThrow(
      'connection lost',
    );
  });

  it('raises LOCKER_NOT_FOUND for an unknown id', async () => {
    repository.findByIdWithCurrentPackage.mockResolvedValue(null);
    await expect(service.getById('missing')).rejects.toBeInstanceOf(LockerNotFoundError);
  });
});
