import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../../auth/public.decorator';
import { DataSource } from 'typeorm';

@ApiTags('health')
// Reachable without a session: container healthchecks and uptime monitors have no cookie.
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  @ApiOperation({ summary: 'Liveness + database connectivity check' })
  async check(): Promise<{ status: 'ok'; database: 'up'; timestamp: string }> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database unreachable');
    }
    return { status: 'ok', database: 'up', timestamp: new Date().toISOString() };
  }
}
