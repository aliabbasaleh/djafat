import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequirePermission, RequireRole, RequireStepUp } from '../auth/decorators';
import { OrdersService } from './orders.service';
import {
  OrdersAdminQuerySchema,
  type OrdersAdminQueryInput,
} from './dto/orders-admin-query.schema';
import { AdminCancelOrderSchema, type AdminCancelOrderInput } from './dto/cancel-order.schema';

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

  /**
   * Staff cancel an order (ORD-01): any status up to `courier_assigned`. The
   * delivery in progress is cancelled and a paid order refunded (PAY-04).
   * Money moves, so a recent MFA step-up is required (docs/05 §5.4).
   */
  @Post(':id/cancel')
  @HttpCode(200)
  @RequireAuth()
  @RequireStepUp()
  @RequireRole('admin', 'super_admin')
  @RequirePermission('orders:write')
  cancel(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminCancelOrderSchema)) body: AdminCancelOrderInput,
  ) {
    const role = actor.roles.includes('super_admin') ? 'super_admin' : 'admin';
    return this.orders.cancelByAdmin(id, { role }, body.reason);
  }
}
