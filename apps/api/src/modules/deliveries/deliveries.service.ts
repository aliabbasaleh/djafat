import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { MoneyJson, OrderAmountPort } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { toMoneyJson } from '../../common/money/money.mapper';
import { ORDER_AMOUNT_PORT } from '../../common/ports/order-amount.port';
import { LedgerService } from '../ledger/ledger.service';
import { buildFundsAvailableEntries } from './release-entries';

export interface DeliveryDto {
  id: string;
  orderId: string;
  courierId: string;
  status: string;
  courierFee: MoneyJson;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
}

/**
 * Delivery/courier minimal path for the Bloc 0.5 walking skeleton (docs/18
 * §2). No dispatch, no geo — a single seeded courier, three orchestration
 * steps. `deliveries` NEVER imports `orders` (DAG — docs/15 AD-09): the order
 * state machine is advanced by `orders` reacting to `delivery.*` events
 * (`emitAsync`, so an illegal order transition surfaces as a real error here
 * instead of a silent orphan `deliveries` row).
 */
@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly events: EventEmitter2,
    @Inject(ORDER_AMOUNT_PORT) private readonly orderAmount: OrderAmountPort,
  ) {}

  async assign(
    orderId: string,
    idempotencyKey: string,
  ): Promise<{ status: string; delivery: DeliveryDto }> {
    const run = await this.idempotency.run('deliveries:assign', idempotencyKey, { orderId }, () =>
      this.doAssign(orderId),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doAssign(orderId: string): Promise<DeliveryDto> {
    const breakdown = await this.orderAmount.getAccrualBreakdown(orderId);
    if (!breakdown.courierId) {
      throw new ConflictException({
        code: 'VALIDATION_ERROR',
        message: `Order ${orderId} has no courier resolved (docs/18 §4).`,
      });
    }

    // Validates + applies `ready -> courier_assigned` in `orders` FIRST — if the
    // order isn't `ready`, this throws and NO `deliveries` row is created.
    await this.events.emitAsync('delivery.assigned', { orderId, courierId: breakdown.courierId });

    const delivery = await this.prisma.delivery.upsert({
      where: { orderId },
      update: {},
      create: {
        orderId,
        courierId: breakdown.courierId,
        status: 'assigned',
        currency: breakdown.courierFee.currency,
        courierFeeMinor: breakdown.courierFee.minor,
        assignedAt: new Date(),
      },
    });

    this.events.emit('order.updated', { orderId, status: 'courier_assigned' });
    return this.toDto(delivery);
  }

  async markPickedUp(
    orderId: string,
    idempotencyKey: string,
  ): Promise<{ status: string; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:picked-up',
      idempotencyKey,
      { orderId },
      () => this.doMarkPickedUp(orderId),
    );
    return { status: run.status, delivery: run.response };
  }

  private async doMarkPickedUp(orderId: string): Promise<DeliveryDto> {
    // `courier_assigned -> picked_up -> on_the_way` validated inside `orders`.
    await this.events.emitAsync('delivery.picked_up', { orderId });
    await this.prisma.delivery.updateMany({
      where: { orderId, status: 'assigned' },
      data: { status: 'picked_up', pickedUpAt: new Date() },
    });
    this.events.emit('order.updated', { orderId, status: 'on_the_way' });
    return this.getByOrderIdOrThrow(orderId);
  }

  async markDelivered(
    orderId: string,
    idempotencyKey: string,
  ): Promise<{ status: string; delivery: DeliveryDto }> {
    const run = await this.idempotency.run(
      'deliveries:delivered',
      idempotencyKey,
      { orderId },
      () => this.doMarkDelivered(orderId),
    );
    return { status: run.status, delivery: run.response };
  }

  /**
   * Idempotent + atomic with `funds_available` (docs/18 §16): the conditional
   * UPDATE on `deliveries.status` and the ledger release happen in ONE
   * transaction, so two concurrent "delivered" calls can never double-release
   * funds. The `orders.status -> delivered` transition happens AFTER commit,
   * via an event — same pattern as `payments` (docs/18 §5, §11).
   */
  private async doMarkDelivered(orderId: string): Promise<DeliveryDto> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; courier_id: string; currency: string }>>`
        UPDATE deliveries SET status = 'delivered', delivered_at = now()
        WHERE order_id = ${orderId}::uuid AND status IN ('assigned', 'picked_up')
        RETURNING id, courier_id, currency
      `;
      if (!rows[0]) return null; // already delivered — idempotent no-op

      const delivery = rows[0];
      const breakdown = await this.orderAmount.getAccrualBreakdown(orderId);

      // Pure, unit-tested elsewhere (release-entries.spec.ts) — see docs/18 §16.
      const entries = buildFundsAvailableEntries({ courierId: delivery.courier_id }, breakdown);

      await this.ledger.postEntryGroupTx(tx, {
        kind: 'funds_available',
        idempotencyKey: `delivery:${delivery.id}:funds_available`,
        currency: delivery.currency,
        entries,
        refs: { orderId },
        createdBy: 'deliveries',
      });

      return { deliveryId: delivery.id };
    });

    if (outcome) {
      // Validates + applies `on_the_way -> delivered` in `orders`.
      await this.events.emitAsync('delivery.delivered', { orderId });
      this.events.emit('order.updated', { orderId, status: 'delivered' });
      this.logger.log(
        `delivery ${outcome.deliveryId} delivered (order ${orderId}) — funds released`,
      );
    }

    return this.getByOrderIdOrThrow(orderId);
  }

  async getByOrderIdOrThrow(orderId: string): Promise<DeliveryDto> {
    const d = await this.prisma.delivery.findUnique({ where: { orderId } });
    if (!d)
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `No delivery for order ${orderId}.`,
      });
    return this.toDto(d);
  }

  private toDto(d: {
    id: string;
    orderId: string;
    courierId: string;
    status: string;
    courierFeeMinor: bigint;
    currency: string;
    assignedAt: Date | null;
    pickedUpAt: Date | null;
    deliveredAt: Date | null;
  }): DeliveryDto {
    return {
      id: d.id,
      orderId: d.orderId,
      courierId: d.courierId,
      status: d.status,
      courierFee: toMoneyJson(d.courierFeeMinor, d.currency),
      assignedAt: d.assignedAt ? d.assignedAt.toISOString() : null,
      pickedUpAt: d.pickedUpAt ? d.pickedUpAt.toISOString() : null,
      deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    };
  }
}
