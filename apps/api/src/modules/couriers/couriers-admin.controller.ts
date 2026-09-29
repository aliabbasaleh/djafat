import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
import { CouriersService } from './couriers.service';

/**
 * Admin-only courier supervision (docs/25 §35 ADMIN tier). Minimal on
 * purpose — suspend/reinstate is the one lever this bloc needs; a fuller
 * back-office (courier onboarding review, documents, ratings) is Bloc 9+.
 */
@ApiTags('admin')
@Controller('admin/couriers')
export class CouriersAdminController {
  constructor(private readonly couriers: CouriersService) {}

  @Post(':userId/suspend')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  @RequirePermission('couriers:write')
  suspend(@Param('userId') userId: string) {
    return this.couriers.suspend(userId);
  }

  @Post(':userId/reinstate')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  @RequirePermission('couriers:write')
  reinstate(@Param('userId') userId: string) {
    return this.couriers.reinstate(userId);
  }
}
