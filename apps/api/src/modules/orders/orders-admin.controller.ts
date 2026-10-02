import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
import { OrdersService } from './orders.service';
import {
  OrdersAdminQuerySchema,
  type OrdersAdminQueryInput,
} from './dto/orders-admin-query.schema';

/**
 * Minimal operational order search for admin/support (Bloc 9, docs/30
 * §admin-api) — a summary list, never a full analytics/reporting surface.
 * Separate from `OrdersController` (customer-facing create/get/confirm/
 * ready/reject): different actor, same split every other domain already has
 * (`couriers` / `couriers-admin`, `catalog-management` / `restaurants-admin`).
 */
@ApiTags('admin')
@Controller('admin/orders')
export class OrdersAdminController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'support')
  @RequirePermission('orders:read')
  list(@Query(new ZodValidationPipe(OrdersAdminQuerySchema)) query: OrdersAdminQueryInput) {
    return this.orders.listForAdmin(
      {
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.restaurantId !== undefined ? { restaurantId: query.restaurantId } : {}),
      },
      query.page,
      query.limit,
    );
  }
}
