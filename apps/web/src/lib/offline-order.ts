import { formatOrderMessage, type OfflineOrder } from '@djafat/core';
import type { Cart } from '@djafat/sdk';

/**
 * FEAT-017 (SPEC-017-03) — when the data connection fails at checkout, the
 * same order is sent by WhatsApp or SMS. The idempotency key is shared with
 * `POST /orders`: whichever gets through first creates the order, the other
 * one finds it again.
 */

const KEY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** 12 random characters, short enough for an SMS, accepted as an Idempotency-Key. */
export function newOrderKey(random: (n: number) => Uint8Array = randomBytes): string {
  return Array.from(random(12), (b) => KEY_ALPHABET.charAt(b & 0x1f)).join('');
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Network down or server unreachable: worth retrying with the same key. */
export function isTransient(err: unknown): boolean {
  const e = err as { code?: string; status?: number } | null;
  return !!e && (e.code === 'NETWORK' || (typeof e.status === 'number' && e.status >= 500));
}

/** Waits between automatic retries of the same order (seconds). */
export const RETRY_DELAYS_S = [2, 5, 12] as const;

export function offlineOrderText(
  cart: Cart,
  addressId: string,
  payment: OfflineOrder['payment'],
  key: string,
): string | null {
  if (!cart.restaurantId || cart.items.length === 0) return null;
  return formatOrderMessage({
    restaurant: cart.restaurantId.slice(0, 8),
    items: cart.items.map((i) => ({
      product: i.productId.slice(0, 8),
      quantity: i.quantity,
      options: i.options.map((o) => o.optionId.slice(0, 8)),
    })),
    address: addressId.slice(0, 8),
    payment,
    key,
  });
}

/** WhatsApp, SMS and call links to DJAFAT's ordering number (E.164). */
export function offlineLinks(number: string, text: string, callNumber: string = number) {
  const digits = number.replace(/[^\d]/g, '');
  return {
    whatsapp: `https://wa.me/${digits}?text=${encodeURIComponent(text)}`,
    sms: `sms:+${digits}?body=${encodeURIComponent(text)}`,
    call: `tel:+${callNumber.replace(/[^\d]/g, '')}`,
  };
}
