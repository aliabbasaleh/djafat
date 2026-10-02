import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
import { CouriersService } from './couriers.service';
import { LedgerReadService } from '../ledger/ledger-read.service';
import {
  CouriersAdminQuerySchema,
  type CouriersAdminQueryInput,
} from './dto/couriers-admin-query.schema';

/**
 * Admin-only courier supervision (docs/25 §35 ADMIN tier). Minimal on
 * purpose — suspend/reinstate was the one lever before this bloc; Bloc 9
 * (docs/30 §admin-api) adds read-only listing + balance, still no document
 * review/ratings/full back-office.
 */
@ApiTags('admin')
@Controller('admin/couriers')
export class CouriersAdminController {
  constructor(
    private readonly couriers: CouriersService,
    private readonly ledgerRead: LedgerReadService,
  ) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  @RequirePermission('couriers:read')
  list(@Query(new ZodValidationPipe(CouriersAdminQuerySchema)) query: CouriersAdminQueryInput) {
    return this.couriers.listForAdmin(query.status, query.page, query.limit);
  }

  @Get(':userId/balance')
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'finance')
  @RequirePermission('ledger:read')
  balance(@Param('userId') userId: string) {
    return this.ledgerRead.getOwnerBalances('courier', userId);
  }

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
