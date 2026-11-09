import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { UsersService } from '../users/users.service';
import { AddressesService, type AddressDto } from '../addresses/addresses.service';
import { CartsService } from '../carts/carts.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import type { PhoneOrderBody } from './dto/phone-order.schema';

/**
 * An order taken on the phone by a DJAFAT operator (standardiste) for a
 * customer who called the national number (FEAT-011). It reuses exactly what
 * the app does — the customer's account (found or created by phone), their
 * address book, their cart, `OrdersService.createOrder` and a pay-on-delivery
 * payment — so prices, opening hours, dispatch, cash control and the ledger
 * behave as for any app order. Only the composition is new; `admin` is the
 * one module allowed to compose the others (api-boundaries DAG).
 *
 * Retry-safe: every step is keyed on the operator's idempotency key — the
 * account and the address are found again, `createOrder` and `createPayment`
 * replay their first result.
 */
@Injectable()
export class PhoneOrdersService {
  private readonly logger = new Logger(PhoneOrdersService.name);

  constructor(
    private readonly users: UsersService,
    private readonly addresses: AddressesService,
    private readonly carts: CartsService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /** The same key with the same order answers the first result (double click, retry). */
  async place(
    input: PhoneOrderBody,
    operator: { userId: string; role: string },
    idempotencyKey: string,
  ) {
    const run = await this.idempotency.run(
      `phone-orders:${operator.userId}`,
      idempotencyKey,
      input,
      () => this.doPlace(input, operator, idempotencyKey),
    );
    return { status: run.status, ...run.response };
  }

  private async doPlace(
    input: PhoneOrderBody,
    operator: { userId: string; role: string },
    idempotencyKey: string,
  ) {
    const { userId: customerId, isNew } = await this.users.findOrCreateByPhone(
      input.customerPhone,
      null,
    );
    if (input.customerName) {
      const existing = await this.users.getByIdOrThrow(customerId);
      if (!existing.fullName) await this.users.updateFullName(customerId, input.customerName);
    }

    const address = await this.findOrCreateAddress(customerId, input.address);

    // The phone order replaces whatever the customer had left in the app cart.
    await this.carts.clearCart(customerId);
    for (const item of input.items) {
      await this.carts.addItem(customerId, {
        productId: item.productId,
        quantity: item.quantity,
        selectedOptionIds: item.selectedOptionIds ?? [],
        replaceCart: true,
      });
    }

    const { status, order } = await this.orders.createOrder(
      customerId,
      `phone:${idempotencyKey}`,
      address.id,
    );
    // A replay leaves the cart rebuilt above unused: empty it again.
    if (status === 'replayed') await this.carts.clearCart(customerId);

    // Paid on delivery: cash to the courier, or Airtel/Tigo at the door.
    // Chosen by capability, never by provider name.
    const current = await this.orders.getOrder(order.id);
    const awaiting = current.status === 'awaiting_payment';
    const methods = awaiting ? await this.payments.listMethodsForOrder(order.id) : [];
    const onDelivery = methods.find(
      (m) => (m.capabilities as { collectedOnDelivery?: boolean }).collectedOnDelivery === true,
    );
    if (awaiting && !onDelivery) {
      throw new ConflictException({
        code: 'PAYMENT_METHOD_UNAVAILABLE',
        message: 'Payment on delivery is not enabled for this restaurant or city.',
      });
    }
    if (onDelivery) {
      await this.payments.createPayment(
        {
          orderId: order.id,
          providerCode: onDelivery.providerCode,
          methodCode: onDelivery.methodCode,
        },
        `phone:${idempotencyKey}`,
      );
    }

    if (status === 'created') {
      await this.audit.log({
        actorUserId: operator.userId,
        actorRole: operator.role,
        action: 'ORDER_PLACED_BY_PHONE',
        entityType: 'order',
        entityId: order.id,
        metadata: { customerId, newCustomer: isNew, code: order.code },
      });
      this.logger.log(`phone order ${order.code} placed by operator ${operator.userId}`);
    }

    return {
      customer: { id: customerId, isNew },
      order: await this.orders.getOrder(order.id),
    };
  }

  /** The same address is not duplicated when the customer calls again (or on a retry). */
  private async findOrCreateAddress(
    customerId: string,
    a: PhoneOrderBody['address'],
  ): Promise<AddressDto> {
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
    const known = (await this.addresses.list(customerId)).find(
      (x) =>
        norm(x.quartier) === norm(a.quartier) &&
        norm(x.landmark) === norm(a.landmark) &&
        norm(x.street) === norm(a.street) &&
        (a.coordinates === undefined ||
          (x.lat === a.coordinates.lat && x.lng === a.coordinates.lng)),
    );
    if (known) return known;
    return this.addresses.create(customerId, {
      label: 'Commande par téléphone',
      quartier: a.quartier,
      landmark: a.landmark,
      ...(a.street ? { street: a.street } : {}),
      ...(a.instructions ? { instructions: a.instructions } : {}),
      ...(a.coordinates ? { coordinates: a.coordinates } : {}),
    });
  }
}
