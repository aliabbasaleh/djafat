#!/usr/bin/env node
// Cash-on-delivery trust against a REAL running API + worker (FEAT-015).
//
//   node scripts/e2e/cod-trust.mjs
//
// A. A brand-new customer may pay up to 10 000 FCFA in cash; above, cash is
//    hidden and refused (409 COD_LIMIT) while mobile money stays offered.
// B. The courier is told it is the customer's first order.
// C. After two deliveries failed at the door, cash is refused at any amount.
//
// A. App + Airtel Money: the customer pays FIRST; the restaurant sees nothing
//    and cannot confirm until DJAFAT has received the transfer.
// B. App + cash: nothing to pay up front; the order goes to the restaurant at
//    once, and the payment is only confirmed when the courier has delivered.
// C. Phone + Airtel Money: the operator takes the order for a caller, gives
//    them the delivery code; the caller pays to DJAFAT's number; the operator
//    types the transaction number; only then the restaurant gets it; the
//    courier delivers with the code the operator gave.
//
// Needs: a freshly seeded database, the API with SMS_PROVIDER=http to the
// mock SMS inbox (infra/mock-sms, E2E_SMS_INBOX), MOBILE_MONEY_WALLETS with
// airtel_money enabled, the worker, and the restaurant open. Dev/CI only.
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = `${process.env.E2E_API_URL ?? 'http://localhost:3101'}/v1`;
const INBOX = process.env.E2E_SMS_INBOX ?? 'http://localhost:4020/messages';
const REDIS_PORT = process.env.E2E_REDIS_PORT ?? '56379';
const PG = process.env.E2E_PSQL ?? '-h 127.0.0.1 -p 55432 -U djafat -d djafat';
const CUSTOMER = '+23566000001';
const COURIER = '+23566000002';
const RESTAURANT = '+23566000004';
const OPERATOR = '+23566000005';
const CALLER = '+23566555444';

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

async function waitFor(fn, ms = 60000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(1000);
  }
  return null;
}

const board = async (token) =>
  ((await call('GET', '/orders', { token })).body?.items ?? []).map((o) => o.id);
const orderStatus = (id) => sql(`select status from orders where id='${id}'`);
const paymentStatus = (id) =>
  sql(`select status from payments where order_id='${id}' order by created_at desc limit 1`);

async function cartOrder(token) {
  const menu = (await call('GET', '/restaurants/chez-fatime/menu')).body;
  const poulet = menu.flatMap((c) => c.products).find((p) => /Poulet/.test(p.name));
  const detail = (await call('GET', `/products/${poulet.id}`)).body;
  const opts = detail.optionGroups
    .filter((g) => g.isRequired)
    .map((g) => g.options.find((o) => o.isAvailable).id);
  await call('DELETE', '/carts', { token });
  await call('POST', '/carts/items', {
    token,
    body: { productId: poulet.id, quantity: 1, selectedOptionIds: opts, replaceCart: true },
  });
  return { poulet, opts, order: (await call('POST', '/orders', { token, body: {} })).body.order };
}

async function recordTransfer(staff, { amountMinor, ref, sender }) {
  return call('POST', '/payments/mobile-money/receipts', {
    token: staff,
    body: {
      providerCode: 'airtel_money',
      transactionRef: ref,
      amount: { minor: String(amountMinor), currency: 'XAF' },
      senderPhone: sender,
      receivedAt: new Date().toISOString(),
    },
  });
}

/** Courier online near the restaurant, kitchen ready, pickup, then delivery with `code`. */
async function deliver(orderId, { kitchen, courier, code }) {
  const [lat, lng] = sql(
    `select ST_Y(geom::geometry)||' '||ST_X(geom::geometry) from restaurants where slug='chez-fatime'`,
  )
    .split(' ')
    .map(Number);
  await call('POST', '/couriers/me/status', { token: courier, body: { status: 'online' } });
  await call('POST', '/couriers/me/location', {
    token: courier,
    body: { lat: lat + 0.002, lng, accuracyM: 10 },
  });
  await call('POST', `/orders/${orderId}/confirm`, { token: kitchen });
  await call('POST', `/orders/${orderId}/ready`, { token: kitchen });
  const did = await waitFor(
    () =>
      sql(
        `select d.id from deliveries d join delivery_offers o on o.delivery_id=d.id where d.order_id='${orderId}' and o.status='offered'`,
      ) || null,
  );
  if (!did) return { delivered: false, why: 'no offer' };
  await call('POST', `/deliveries/${did}/accept`, { token: courier });
  await call('POST', `/deliveries/${did}/pickup`, { token: courier });
  const before = paymentStatus(orderId);
  const proof = await code(did);
  const r = await call('POST', `/deliveries/${did}/deliver`, {
    token: courier,
    body: { proofCode: proof },
  });
  return { delivered: r.status === 200 || r.status === 201, before, status: r.status, proof };
}

const kitchen = await login(RESTAURANT);
const courier = await login(COURIER);
const staff = await login(OPERATOR);
// 22:00–06:00 in N'Djamena (UTC+1): a FIRST order at night is prepaid only (SPEC-015-01 R3).
const localHour = (new Date().getUTCHours() + 1) % 24;
const NIGHT = localHour >= 22 || localHour < 6;
console.log(`heure de N'Djamena : ${localHour} h${NIGHT ? ' (nuit)' : ''}`);
const NEWBIE = `+235665${String(Date.now()).slice(-5)}`;
const ABSENT = `+235667${String(Date.now()).slice(-5)}`;

async function newCustomer(phone) {
  const token = await login(phone);
  await call('POST', '/users/me/addresses', {
    token,
    body: {
      label: 'Maison',
      quartier: 'Moursal',
      landmark: 'derrière la mosquée',
      coordinates: { lat: 12.1106, lng: 15.0584 },
    },
  });
  return token;
}
async function orderOf(token, qty) {
  const menu = (await call('GET', '/restaurants/chez-fatime/menu')).body;
  const poulet = menu.flatMap((c) => c.products).find((p) => /Poulet/.test(p.name));
  const detail = (await call('GET', `/products/${poulet.id}`)).body;
  const opts = detail.optionGroups
    .filter((g) => g.isRequired)
    .map((g) => g.options.find((o) => o.isAvailable).id);
  await call('DELETE', '/carts', { token });
  await call('POST', '/carts/items', {
    token,
    body: { productId: poulet.id, quantity: qty, selectedOptionIds: opts, replaceCart: true },
  });
  return (await call('POST', '/orders', { token, body: {} })).body.order;
}
const methodsOf = async (token, orderId) =>
  ((await call('GET', `/payments/methods-for-order/${orderId}`, { token })).body ?? []).map(
    (m) => m.providerCode,
  );
const payCash = (token, orderId) =>
  call('POST', '/payments', {
    token,
    body: { orderId, providerCode: 'cash', methodCode: 'cash_on_delivery' },
  });

console.log('\nA. Nouveau client');
const n = await newCustomer(NEWBIE);
const small = await orderOf(n, 1);
const smallMethods = await methodsOf(n, small.id);
const okCash = await payCash(n, small.id);
if (NIGHT) {
  check(
    `nuit, 1re commande (${small.total.minor} FCFA) : espèces masquées`,
    !smallMethods.includes('cash'),
  );
  check(
    'nuit, 1re commande : espèces refusées, paiement d’avance demandé',
    okCash.status === 409 && okCash.body?.error?.code === 'COD_LIMIT',
    `HTTP ${okCash.status}`,
  );
} else {
  check(
    `petite commande (${small.total.minor} FCFA) : espèces proposées`,
    smallMethods.includes('cash'),
  );
  check('paiement en espèces accepté', okCash.status === 201, `HTTP ${okCash.status}`);
}
const big = await orderOf(n, 3);
const bigMethods = await methodsOf(n, big.id);
check(
  `grosse commande (${big.total.minor} FCFA) : espèces masquées, Airtel proposé`,
  !bigMethods.includes('cash') && bigMethods.includes('airtel_money'),
  bigMethods.join(','),
);
const refused = await payCash(n, big.id);
check(
  'espèces refusées au-delà de 10 000 FCFA',
  refused.status === 409 && refused.body?.error?.code === 'COD_LIMIT',
  `HTTP ${refused.status} ${refused.body?.error?.code}`,
);

console.log('\nB et C. Client absent deux fois');
const a = await newCustomer(ABSENT);
const [lat, lng] = sql(
  `select ST_Y(geom::geometry)||' '||ST_X(geom::geometry) from restaurants where slug='chez-fatime'`,
)
  .split(' ')
  .map(Number);
for (let i = 0; i < 2; i++) {
  const o = await orderOf(a, 1);
  const pay = await call('POST', '/payments', {
    token: a,
    body: {
      orderId: o.id,
      providerCode: 'airtel_money',
      methodCode: 'mobile_money',
      payerPhone: ABSENT,
    },
  });
  const ref = `CIT${Date.now()}${i}`;
  await call('POST', `/payments/${pay.body.payment.id}/mobile-money/claim`, {
    token: a,
    body: { transactionRef: ref, payerPhone: ABSENT },
  });
  await recordTransfer(staff, { amountMinor: o.total.minor, ref, sender: ABSENT });
  await call('POST', '/couriers/me/status', { token: courier, body: { status: 'online' } });
  await call('POST', '/couriers/me/location', {
    token: courier,
    body: { lat: lat + 0.002, lng, accuracyM: 10 },
  });
  await call('POST', `/orders/${o.id}/confirm`, { token: kitchen });
  await call('POST', `/orders/${o.id}/ready`, { token: kitchen });
  const offer = await waitFor(async () =>
    ((await call('GET', '/couriers/me/offers', { token: courier })).body ?? []).find(
      (x) => x.context?.orderId === o.id,
    ),
  );
  if (i === 0)
    check(
      'le livreur est prévenu : 1re commande du client',
      offer?.context?.customerIsNew === true,
    );
  await call('POST', `/deliveries/${offer.deliveryId}/accept`, { token: courier });
  await call('POST', `/deliveries/${offer.deliveryId}/pickup`, { token: courier });
  const f = await call('POST', `/deliveries/${offer.deliveryId}/fail`, {
    token: courier,
    body: { reason: 'client absent, injoignable' },
  });
  check(
    `livraison ${i + 1} échouée à la porte`,
    f.status === 200 || f.status === 201,
    `HTTP ${f.status}`,
  );
}
const after = await orderOf(a, 1);
check(
  'après 2 absences : espèces masquées même pour une petite commande',
  !(await methodsOf(a, after.id)).includes('cash'),
);
const refused2 = await payCash(a, after.id);
check(
  'après 2 absences : espèces refusées',
  refused2.status === 409 && refused2.body?.error?.code === 'COD_LIMIT',
  `HTTP ${refused2.status}`,
);
const airtel = await call('POST', '/payments', {
  token: a,
  body: {
    orderId: after.id,
    providerCode: 'airtel_money',
    methodCode: 'mobile_money',
    payerPhone: ABSENT,
  },
});
check('il peut toujours payer d’avance par Airtel', airtel.status === 201, `HTTP ${airtel.status}`);

console.log(failed === 0 ? '\nTOUT EST VERT' : `\n${failed} ÉCHEC(S)`);
process.exit(failed === 0 ? 0 : 1);
