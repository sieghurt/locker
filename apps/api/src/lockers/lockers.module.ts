import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PricingModule } from '../pricing/pricing.module';
import { UsersModule } from '../users/users.module';

import { Locker } from './locker.entity';
import { LockerEventsService } from './locker-events.service';
import { LockerSeederService } from './locker-seeder.service';
import { LockersController } from './lockers.controller';
import { LockersRepository } from './lockers.repository';
import { LockersService } from './lockers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Locker]), UsersModule, PricingModule],
  controllers: [LockersController],
  providers: [LockersRepository, LockersService, LockerSeederService, LockerEventsService],
  exports: [LockersRepository, LockersService, LockerEventsService],
})
export class LockersModule {}
