import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
import { RestaurantsManagementService } from './restaurants-management.service';
import { LedgerReadService } from '../ledger/ledger-read.service';
import {
  RestaurantsAdminQuerySchema,
  type RestaurantsAdminQueryInput,
} from './dto/restaurants-admin-query.schema';

/**
 * Admin read-only restaurant listing (Bloc 9, docs/30 §admin-api) — every
 * status visible, unlike the customer-facing catalog. Separate from
 * `CatalogManagementController` (restaurant_owner/staff self-service writes)
 * the same way `couriers-admin.controller.ts` is separate from
 * `couriers.controller.ts`: different actor, different concern.
 */
@ApiTags('admin')
@Controller('admin/restaurants')
export class RestaurantsAdminController {
  constructor(
    private readonly restaurants: RestaurantsManagementService,
    private readonly ledgerRead: LedgerReadService,
  ) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin')
  @RequirePermission('restaurants:read')
  list(
    @Query(new ZodValidationPipe(RestaurantsAdminQuerySchema)) query: RestaurantsAdminQueryInput,
  ) {
    return this.restaurants.listForAdmin(query.search, query.status, query.page, query.limit);
  }

  @Get(':id/balance')
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'finance')
  @RequirePermission('ledger:read')
  balance(@Param('id') id: string) {
    return this.ledgerRead.getOwnerBalances('restaurant', id);
  }
}
