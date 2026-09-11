import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireAuth, RequirePermission, RequireRole, RequireStepUp } from '../auth/decorators';

/**
 * NOT a real admin feature — Bloc 9 owns the actual back-office (see
 * `admin.module.ts`). These two routes exist ONLY to prove the guard stack
 * end to end (docs/19 §37 scenario 3: "ADMIN -> MFA -> privileged operation
 * -> allowed after step-up") against a REAL HTTP round trip, since no real
 * sensitive business endpoint exists yet in this codebase to retrofit.
 */
@ApiTags('admin')
@Controller('admin')
export class AdminController {
  /** Proves `@RequireRole` alone: any admin/super_admin, no step-up needed. */
  @Get('ping')
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  ping() {
    return { status: 'ok' };
  }

  /** Proves the full stack: role + permission + step-up, all required together. */
  @Post('sensitive-ping')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  @RequirePermission('admin:write')
  @RequireStepUp()
  sensitivePing() {
    return { status: 'ok' };
  }
}
