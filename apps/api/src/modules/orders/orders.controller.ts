import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor } from '@djafat/types';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentActor } from '../auth/current-actor.decorator';
import { RequireAuth, RequireRole } from '../auth/decorators';
import { OrdersService } from './orders.service';
import { CreateOrderSchema, type CreateOrderInput } from './dto/create-order.schema';
import { RejectOrderSchema, type RejectOrderInput } from './dto/reject-order.schema';

/** The restaurant-tier role this actor holds — `owner` takes precedence, matching `@djafat/core`'s transition table (both are equally allowed). */
function restaurantRole(actor: AuthenticatedActor): 'restaurant_owner' | 'restaurant_staff' {
  return actor.roles.includes('restaurant_owner') ? 'restaurant_owner' : 'restaurant_staff';
}

/**
 * `create`/`get` are real customer-facing endpoints, closing docs/18 §7
 * dette S-01 (customerId used to be client-supplied). `confirm`/`ready`/
 * `reject` were the Bloc 0.5 restaurant stand-in with NO auth at all (docs/18
 * §3, §8; docs/19 §10 dette D-10) until Bloc 9 (docs/30 §order-authorization)
 * closed it: `@RequireRole` here is the coarse, cheap gate (not even a
 * restaurant-tier role — reject immediately, no DB hit); the FINE-grained
 * check — does this actor actually belong to THIS order's restaurant? — runs
 * inside `OrdersService.transitionOrder`, in the same row-locked transaction
 * as the state change itself (never two separate reads that could drift).
 */
@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /**
   * Creates an order FROM the caller's own cart (docs/22 §9). The body's
   * only allowed field is `addressId` (Bloc 8, docs/29 §checkout) — the
   * client selects WHICH of their own addresses to deliver to; the server
   * resolves, owns, and prices everything else. Omitting it falls back to
   * the customer's default address, unchanged from before this bloc.
   */
  @Post()
  @HttpCode(201)
  @RequireAuth()
  @RequireRole('customer')
  async create(
    @CurrentActor() actor: AuthenticatedActor,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CreateOrderSchema)) body: CreateOrderInput,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required.',
      });
    }
    const { status, order } = await this.orders.createOrder(
      actor.userId,
      idempotencyKey,
      body.addressId,
    );
    return { status, order };
  }

  /**
   * Tenant-scoped (BUG-10.1-AUTH): the owning customer, a member of THIS
   * order's restaurant, the courier currently assigned to its delivery, or
   * staff-tier with `orders:read`. Was `@RequireOwnership(..., 'orders:read')`,
   * whose override bypassed ownership entirely for every holder of
   * `orders:read` — restaurant and courier roles included, so any of them
   * could read any order whose UUID they knew. The decision now lives in
   * `OrdersService.getOrderFor` over the single rule in
   * `common/authz/order-access.ts`.
   */
  @Get(':id')
  @RequireAuth()
  get(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.orders.getOrderFor(actor, id);
  }

  /** The restaurant accepts the order — only a staff/owner of THAT restaurant (docs/30 §order-authorization). */
  @Post(':id/confirm')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('restaurant_owner', 'restaurant_staff')
  confirm(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.orders.confirmOrder(id, { userId: actor.userId, role: restaurantRole(actor) });
  }

  /** The restaurant marks preparation done — same authorization as `confirm`. */
  @Post(':id/ready')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('restaurant_owner', 'restaurant_staff')
  ready(@CurrentActor() actor: AuthenticatedActor, @Param('id') id: string) {
    return this.orders.markReady(id, { userId: actor.userId, role: restaurantRole(actor) });
  }

  /**
   * The restaurant declines the order (`placed -> rejected`) — already
   * fully defined in `@djafat/core`'s state machine before this bloc, only
   * ever unreachable for want of this route + the auth `confirm`/`ready`
   * needed anyway (docs/30 §order-authorization).
   */
  @Post(':id/reject')
  @HttpCode(200)
  @RequireAuth()
  @RequireRole('restaurant_owner', 'restaurant_staff')
  reject(
    @CurrentActor() actor: AuthenticatedActor,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectOrderSchema)) body: RejectOrderInput,
  ) {
    return this.orders.rejectOrder(
      id,
      { userId: actor.userId, role: restaurantRole(actor) },
      body.reason,
    );
  }
}
