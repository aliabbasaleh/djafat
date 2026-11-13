import { HttpException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { parseOrderMessage, type OfflineOrder } from '@djafat/core';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService } from '../users/users.service';
import { AddressesService } from '../addresses/addresses.service';
import { CartsService } from '../carts/carts.service';
import { CatalogService } from '../catalog/catalog.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { DeliveriesService } from '../deliveries/deliveries.service';
import { WhatsappTextReplyService } from '../auth/whatsapp-text-reply.service';
import type { OrderMessageReceived } from '../auth/whatsapp-inbound.service';

export type OfflineOrderOutcome =
  | 'placed'
  | 'awaiting_payment'
  | 'unreadable'
  | 'unknown_customer'
  | 'unknown_restaurant'
  | 'unknown_item'
  | 'unknown_address'
  | 'refused';

/**
 * An order the app could not send (no data connection) and wrote as one
 * WhatsApp/SMS message instead (FEAT-017, SPEC-017-02). It is placed exactly
 * like an app order — the customer's own account, their address book, their
 * cart, `OrdersService.createOrder` and a payment chosen by capability — and
 * under the SAME idempotency key `K` the app used: if the network comes back
 * and the app's own request goes through too, there is still one order.
 *
 * Only an EXISTING account may order this way, and only to one of its own
 * saved addresses: the message proves the number, not who the customer is.
 * The reply gives the order number, the total and the code for the courier.
 */
@Injectable()
export class OfflineOrdersService {
  private readonly logger = new Logger(OfflineOrdersService.name);

  constructor(
    private readonly users: UsersService,
    private readonly addresses: AddressesService,
    private readonly carts: CartsService,
    private readonly catalog: CatalogService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    private readonly deliveries: DeliveriesService,
    private readonly audit: AuditService,
    private readonly reply: WhatsappTextReplyService,
  ) {}

  @OnEvent('order_message.received')
  async onMessage(event: OrderMessageReceived): Promise<void> {
    await this.handle(event.phone, event.text);
  }

  async handle(phone: string, text: string): Promise<{ outcome: OfflineOrderOutcome }> {
    const { outcome, reply } = await this.place(phone, text);
    await this.reply.send(phone, reply);
    this.logger.log(`offline order message: ${outcome}`);
    return { outcome };
  }

  private async place(
    phone: string,
    text: string,
  ): Promise<{ outcome: OfflineOrderOutcome; reply: string }> {
    const parsed = parseOrderMessage(text);
    if (!parsed.ok) {
      return {
        outcome: 'unreadable',
        reply:
          'DJAFAT : ce message de commande est incomplet ou a été modifié. Renvoyez-le depuis l’application sans le changer.',
      };
    }
    const o = parsed.order;
    const user = await this.users.findByPhone(phone);
    if (!user) {
      return {
        outcome: 'unknown_customer',
        reply:
          'DJAFAT : ce numéro n’a pas encore de compte. Créez-le dans l’application, ou appelez-nous pour commander.',
      };
    }
    const resolved = await this.resolve(user.id, o);
    if ('outcome' in resolved) return resolved;

    try {
      await this.carts.clearCart(user.id);
      for (const item of resolved.items) {
        await this.carts.addItem(user.id, {
          productId: item.productId,
          quantity: item.quantity,
          selectedOptionIds: item.optionIds,
          replaceCart: true,
        });
      }
      const { status, order } = await this.orders.createOrder(user.id, o.key, resolved.addressId);
      if (status === 'replayed') await this.carts.clearCart(user.id);

      const instructions = await this.pay(order.id, o.payment, phone, o.key);
      const deliveryCode = await this.deliveries.presetDeliveryCode(order.id, user.id);
      const current = await this.orders.getOrder(order.id);
      if (status === 'created') {
        await this.audit.log({
          actorUserId: user.id,
          actorRole: 'customer',
          action: 'ORDER_PLACED_BY_MESSAGE',
          entityType: 'order',
          entityId: order.id,
          metadata: { code: order.code, payment: o.payment },
        });
      }
      const total = fcfa(current.total.minor);
      if (current.status === 'awaiting_payment' && instructions === null) {
        return {
          outcome: 'awaiting_payment',
          reply: `DJAFAT : commande ${current.code} (${total}) enregistrée, mais le paiement à la livraison n’est pas possible pour elle. Payez par Airtel Money depuis l’application dès que la connexion revient.`,
        };
      }
      const how =
        o.payment === 'cash'
          ? 'à payer en espèces au livreur.'
          : `${(instructions || 'Payez par Airtel Money.').replace(/\.*$/, '')}.`;
      return {
        outcome: 'placed',
        reply: `DJAFAT : commande ${current.code} reçue. Total ${total}, ${how} Code à donner au livreur : ${deliveryCode}.`,
      };
    } catch (err) {
      const code =
        err instanceof HttpException
          ? ((err.getResponse() as { code?: string }).code ?? String(err.getStatus()))
          : 'ERROR';
      this.logger.warn(`offline order refused: ${code}`);
      return {
        outcome: 'refused',
        reply: `DJAFAT : la commande n’a pas pu être passée (${refusalText(code)}). Réessayez depuis l’application ou appelez-nous.`,
      };
    }
  }

  /** Prefixes → ids, each one unique within the restaurant's menu / the customer's addresses. */
  private async resolve(
    customerId: string,
    o: OfflineOrder,
  ): Promise<
    | { outcome: OfflineOrderOutcome; reply: string }
    | {
        addressId: string;
        items: Array<{ productId: string; quantity: number; optionIds: string[] }>;
      }
  > {
    const restaurantId = await this.catalog.findRestaurantIdByRef(o.restaurant);
    if (!restaurantId) {
      return {
        outcome: 'unknown_restaurant',
        reply: 'DJAFAT : ce restaurant n’est pas disponible pour le moment.',
      };
    }
    const unknownItem = {
      outcome: 'unknown_item' as const,
      reply:
        'DJAFAT : un plat de cette commande n’est plus à la carte. Ouvrez l’application pour refaire le panier.',
    };
    let menuProductIds: string[];
    try {
      menuProductIds = (await this.catalog.getMenu(restaurantId)).flatMap((c) =>
        c.products.map((p) => p.id),
      );
    } catch {
      return unknownItem;
    }
    const items: Array<{ productId: string; quantity: number; optionIds: string[] }> = [];
    for (const it of o.items) {
      const productId = unique(menuProductIds, it.product);
      if (!productId) return unknownItem;
      let optionIds: string[] = [];
      if (it.options.length > 0) {
        const detail = await this.catalog.getProductDetail(productId);
        const all = detail.optionGroups.flatMap((g) => g.options.map((x) => x.id));
        const picked = it.options.map((p) => unique(all, p));
        if (picked.some((x) => x === null)) return unknownItem;
        optionIds = picked as string[];
      }
      items.push({ productId, quantity: it.quantity, optionIds });
    }
    const addressId = unique(
      (await this.addresses.list(customerId)).map((a) => a.id),
      o.address,
    );
    if (!addressId) {
      return {
        outcome: 'unknown_address',
        reply:
          'DJAFAT : l’adresse de cette commande n’est pas dans votre carnet. Ouvrez l’application pour la choisir.',
      };
    }
    return { addressId, items };
  }

  /** The payment, chosen by capability (never by provider name); null if none fits. */
  private async pay(
    orderId: string,
    wanted: OfflineOrder['payment'],
    payerPhone: string,
    key: string,
  ): Promise<string | null> {
    const current = await this.orders.getOrder(orderId);
    if (current.status !== 'awaiting_payment') return ''; // already paid / placed (a resend)
    const methods = await this.payments.listMethodsForOrder(orderId);
    const chosen = methods.find((m) => {
      const caps = m.capabilities as {
        collectedOnDelivery?: boolean;
        matchedByTransferReceipt?: boolean;
      };
      return wanted === 'cash'
        ? caps.collectedOnDelivery === true
        : caps.matchedByTransferReceipt === true && m.providerCode === 'airtel_money';
    });
    if (!chosen) return null;
    try {
      const created = await this.payments.createPayment(
        {
          orderId,
          providerCode: chosen.providerCode,
          methodCode: chosen.methodCode,
          ...(wanted === 'airtel' ? { payerPhone } : {}),
        },
        `offline:${key}`,
      );
      return created.payment.action?.instructions ?? '';
    } catch (err) {
      // e.g. COD_LIMIT (FEAT-015): the order stays awaiting payment
      if (err instanceof HttpException && err.getStatus() === 409) return null;
      throw err;
    }
  }
}

function unique(ids: readonly string[], prefix: string): string | null {
  const hits = ids.filter((id) => id.toLowerCase().startsWith(prefix));
  return hits.length === 1 ? hits[0]! : null;
}

function fcfa(minor: string): string {
  return `${minor.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}

function refusalText(code: string): string {
  const map: Record<string, string> = {
    RESTAURANT_CLOSED: 'le restaurant est fermé',
    PRODUCT_UNAVAILABLE: 'un plat n’est plus disponible',
    MIN_ORDER_NOT_MET: 'le minimum de commande n’est pas atteint',
    IDEMPOTENCY_KEY_REUSED: 'commande déjà envoyée avec une autre adresse',
  };
  return map[code] ?? 'erreur';
}
