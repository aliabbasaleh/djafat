import { Controller, Get, HttpCode } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { AppConfigService } from '../config/config.service';

const SERVICE = 'djafat-api';
const VERSION = process.env['npm_package_version'] ?? '0.0.0';
const startedAt = Date.now();

@ApiTags('system')
@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  /** Liveness — the process is up. Never touches dependencies. */
  @Get('health')
  @HttpCode(200)
  health() {
    return {
      status: 'ok' as const,
      service: SERVICE,
      version: VERSION,
      env: this.config.get('NODE_ENV'),
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    };
  }

  /** Readiness — dependencies are reachable. Used by the load balancer. */
  @Get('ready')
  async ready() {
    const [db, redis] = await Promise.all([this.prisma.healthy(), this.redis.ping()]);
    const checks = {
      postgres: { ok: db },
      redis: { ok: redis },
    };
    const ok = Object.values(checks).every((c) => c.ok);
    return { status: ok ? ('ready' as const) : ('not_ready' as const), checks };
  }
}
