#!/usr/bin/env node
// Order sent by WhatsApp when the data connection fails, against a REAL running API (FEAT-017).
//
//   node scripts/e2e/offline-order.mjs
//
// The customer's app could not send the order; it wrote it as one message
// (`DJF1 …`) and the customer sent it to DJAFAT's WhatsApp number. The signed
// Meta webhook delivers it: the order is placed under the app's own key, the
// customer gets a reply (order number, total, code for the courier). When the
// network comes back the app sends the same order with the same key: still
// one order. A damaged message, or a number without an account, gets an
// explanation and no order.
//
// Needs: a freshly seeded database, the API with SMS_PROVIDER=http to the
// mock SMS inbox, WHATSAPP_PROVIDER=mock, WHATSAPP_APP_SECRET and
// WHATSAPP_PHONE_NUMBER_ID exported here too, airtel_money enabled, the
// restaurant open. Dev/CI only.
import { createHmac, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatOrderMessage } = require('../../packages/core/dist/index.js');

const API = `${process.env.E2E_API_URL ?? 'http://localhost:3101'}/v1`;
const INBOX = process.env.E2E_SMS_INBOX ?? 'http://localhost:4020/messages';
const REDIS_PORT = process.env.E2E_REDIS_PORT ?? '56379';
const PG = process.env.E2E_PSQL ?? '-h 127.0.0.1 -p 55432 -U djafat -d djafat';
const SECRET = process.env.WHATSAPP_APP_SECRET;
const NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const CUSTOMER = '+23566000001';
const STRANGER = '+23566777888';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const redis = (cmd) => execSync(`redis-cli -p ${REDIS_PORT} ${cmd}`).toString().trim();
const sql = (q) => execSync(`psql ${PG} -tAc "${q}"`).toString().trim();

async function call(method, path, { token, body, idem } = {}) {
  const headers = body === undefined ? {} : { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem ?? method !== 'GET') headers['idempotency-key'] = idem ?? randomUUID();
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

async function login(phone) {
  for (const k of redis('--scan --pattern ratelimit:otp:*').split('\n').filter(Boolean)) {
    redis(`del ${k}`);
  }
  const seen = new Set((await (await fetch(INBOX)).json()).messages.map((m) => m.id));
  await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  for (let i = 0; i < 40; i++) {
    const m = (await (await fetch(INBOX)).json()).messages.find(
      (x) => x.to === phone && !seen.has(x.id),
    );
    if (m) {
      const code = /(\d{6})/.exec(m.body)[1];
      const r = await call('POST', '/auth/otp/verify', { body: { phone, code, purpose: 'login' } });
      return r.body.access;
    }
    await sleep(250);
  }
  throw new Error(`no login code for ${phone}`);
}

/** What Meta posts when `phone` writes `text` to DJAFAT's number, signed like Meta. */
async function whatsapp(phone, text) {
  const raw = JSON.stringify({
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: NUMBER_ID },
              messages: [
                {
                  from: phone.replace('+', ''),
                  id: `wamid.${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const res = await fetch(`${API}/auth/whatsapp/webhook`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`,
    },
    body: raw,
  });
  return res.status;
}
const replies = (phone) => redis(`lrange wa:mock:reply:${phone} 0 -1`).split('\n').filter(Boolean);

async function main() {
  if (!SECRET || !NUMBER_ID)
    throw new Error('export WHATSAPP_APP_SECRET and WHATSAPP_PHONE_NUMBER_ID');
  redis(`del wa:mock:reply:${CUSTOMER} wa:mock:reply:${STRANGER}`);
  const token = await login(CUSTOMER);

  // The customer's cart and saved address, as the app has them.
  let address = (await call('GET', '/users/me/addresses', { token })).body?.[0];
  if (!address) {
    address = (
      await call('POST', '/users/me/addresses', {
        token,
        body: { label: 'Maison', quartier: 'Moursal', landmark: 'Derrière la mosquée' },
      })
    ).body;
  }
  const menu = (await call('GET', '/restaurants/chez-fatime/menu')).body;
  const restaurantId = sql(`select id from restaurants where slug='chez-fatime'`);
  const poulet = menu.flatMap((c) => c.products).find((p) => /Poulet/.test(p.name));
  const detail = (await call('GET', `/products/${poulet.id}`)).body;
  const opts = detail.optionGroups
    .filter((g) => g.isRequired)
    .map((g) => g.options.find((o) => o.isAvailable).id);
  await call('DELETE', '/carts', { token });
  await call('POST', '/carts/items', {
    token,
    body: { productId: poulet.id, quantity: 2, selectedOptionIds: opts, replaceCart: true },
  });
  const before = Number(
    sql(
      `select count(*) from orders where customer_id=(select id from users where phone='${CUSTOMER}')`,
    ),
  );

  // 1. No data: the app wrote the order as one message; the customer sends it by WhatsApp.
  const key = 'k' + randomUUID().replace(/-/g, '').slice(0, 11);
  const text = formatOrderMessage({
    restaurant: restaurantId.slice(0, 8),
    items: [
      { product: poulet.id.slice(0, 8), quantity: 2, options: opts.map((o) => o.slice(0, 8)) },
    ],
    address: address.id.slice(0, 8),
    payment: 'airtel',
    key,
  });
  check('the order fits in one SMS', text.length <= 160, `${text.length} caractères : ${text}`);
  check('signed WhatsApp message accepted', (await whatsapp(CUSTOMER, text)) === 200);
  const reply = replies(CUSTOMER).at(-1) ?? '';
  const code = /commande (\S+) reçue/.exec(reply)?.[1];
  check(
    'reply: order number, total, courier code, Airtel instructions',
    !!code && /FCFA/.test(reply) && /livreur : \d{4}/.test(reply),
    reply,
  );
  const orderId = sql(`select id from orders where code='${code}'`);
  check(
    'order created for the customer',
    !!orderId && sql(`select status from orders where id='${orderId}'`) === 'awaiting_payment',
  );
  check(
    'Airtel payment from the sender number',
    sql(`select count(*) from payments where order_id='${orderId}'`) === '1',
  );

  // 2. The network is back: the app sends the same order with the same key.
  const app = await call('POST', '/orders', { token, body: { addressId: address.id }, idem: key });
  check('the app gets the SAME order back', app.body?.order?.id === orderId, `HTTP ${app.status}`);

  // 3. The customer sends the message again.
  await whatsapp(CUSTOMER, text);
  check('a resend answers the same order', (replies(CUSTOMER).at(-1) ?? '').includes(code));
  const after = Number(
    sql(
      `select count(*) from orders where customer_id=(select id from users where phone='${CUSTOMER}')`,
    ),
  );
  check(
    'one order only, one payment only',
    after === before + 1 &&
      sql(`select count(*) from payments where order_id='${orderId}'`) === '1',
    `${after - before} commande(s)`,
  );
  check(
    'audited as placed by message',
    sql(
      `select count(*) from audit_logs where action='ORDER_PLACED_BY_MESSAGE' and entity_id='${orderId}'`,
    ) === '1',
  );

  // 4. Damaged message, unknown number.
  await whatsapp(CUSTOMER, text.replace('x2', 'x9'));
  check(
    'damaged message: explained, nothing ordered',
    /incomplet ou a été modifié/.test(replies(CUSTOMER).at(-1) ?? ''),
  );
  await whatsapp(STRANGER, text);
  check(
    'number without an account: explained, nothing ordered',
    /pas encore de compte/.test(replies(STRANGER).at(-1) ?? '') &&
      sql(`select count(*) from users where phone='${STRANGER}'`) === '0',
  );

  console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
