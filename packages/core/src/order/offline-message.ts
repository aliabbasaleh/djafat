/**
 * An order written as one SMS / WhatsApp message, for when the data
 * connection fails at checkout (FEAT-017, SPEC-017-01). Pure; shared by the
 * web app (writes it) and the API (reads it).
 *
 *   DJF1 R:<restaurant slug> I:<p8>x<qty>[.<o8>…],… A:<address8> P:<C|A> K:<key> C:<checksum>
 *
 * Ids are the first 8 hex characters of the product / option / address UUID,
 * resolved by the server within the restaurant's menu and the customer's own
 * address book. `K` is the order's idempotency key: the same order sent by
 * the app once the network is back, and by message, is created once.
 */
export interface OfflineOrder {
  readonly restaurant: string;
  readonly items: ReadonlyArray<{
    readonly product: string;
    readonly quantity: number;
    readonly options: readonly string[];
  }>;
  readonly address: string;
  readonly payment: 'cash' | 'airtel';
  readonly key: string;
}

export type ParsedOrderMessage =
  | { readonly ok: true; readonly order: OfflineOrder }
  | { readonly ok: false; readonly reason: 'not_an_order' | 'malformed' | 'checksum' };

const ID8 = /^[0-9a-f]{8}$/;
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // base32 without i, l, o, u

/** CRC-8 (poly 0x07) of the message body, written as 2 base32 characters. */
function checksum(body: string): string {
  let crc = 0;
  for (let k = 0; k < body.length; k += 1) {
    crc ^= body.charCodeAt(k) & 0xff; // the body is ASCII (checked by the parser)
    for (let i = 0; i < 8; i += 1)
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return `${ALPHABET.charAt(crc >> 5)}${ALPHABET.charAt(crc & 0x1f)}`;
}

export function formatOrderMessage(o: OfflineOrder): string {
  const items = o.items
    .map((i) => [`${i.product}x${i.quantity}`, ...i.options].join('.'))
    .join(',');
  const body = `DJF1 R:${o.restaurant} I:${items} A:${o.address} P:${o.payment === 'cash' ? 'C' : 'A'} K:${o.key}`;
  return `${body} C:${checksum(body)}`;
}

export function parseOrderMessage(text: string): ParsedOrderMessage {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!/^djf1 /i.test(t)) return { ok: false, reason: 'not_an_order' };
  const m =
    /^DJF1 R:([a-z0-9-]{1,40}) I:(\S+) A:([0-9a-f]{8}) P:([CA]) K:([a-z0-9]{6,20}) C:([0-9a-z]{2})$/.exec(
      `DJF1${t.slice(4)}`,
    );
  if (!m) return { ok: false, reason: 'malformed' };
  const [, restaurant, itemsRaw, address, pay, key, sum] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const items: Array<{ product: string; quantity: number; options: string[] }> = [];
  for (const part of itemsRaw.split(',')) {
    const [head, ...options] = part.split('.');
    const im = /^([0-9a-f]{8})x(\d{1,2})$/.exec(head ?? '');
    if (!im || options.some((x) => !ID8.test(x))) return { ok: false, reason: 'malformed' };
    const quantity = Number(im[2]);
    if (quantity < 1) return { ok: false, reason: 'malformed' };
    items.push({ product: im[1]!, quantity, options });
  }
  if (items.length === 0 || items.length > 10) return { ok: false, reason: 'malformed' };
  const body = `DJF1 R:${restaurant} I:${itemsRaw} A:${address} P:${pay} K:${key}`;
  if (checksum(body) !== sum) return { ok: false, reason: 'checksum' };
  return {
    ok: true,
    order: { restaurant, items, address, payment: pay === 'C' ? 'cash' : 'airtel', key },
  };
}
