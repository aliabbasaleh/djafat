#!/usr/bin/env node
// Payment rules against a REAL running API + worker (FEAT-009, FEAT-011, FEAT-012).
//
//   node scripts/e2e/payment-rules.mjs
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
const staff = await login(OPERATOR);
const courier = await login(COURIER);

// ── A. App + Airtel: pay first ───────────────────────────────────────────────
{
  console.log('\nA. Application + Airtel Money : le client paie d’abord');
  const cust = await login(CUSTOMER);
  const { order } = await cartOrder(cust);
  const pay = await call('POST', '/payments', {
    token: cust,
    body: {
      orderId: order.id,
      providerCode: 'airtel_money',
      methodCode: 'mobile_money',
      payerPhone: CUSTOMER,
    },
  });
  check('paiement Airtel créé, en attente', pay.body?.payment?.status === 'pending');
  check('la commande attend le paiement', orderStatus(order.id) === 'awaiting_payment');
  check('le restaurant ne la voit pas encore', !(await board(kitchen)).includes(order.id));
  const early = await call('POST', `/orders/${order.id}/confirm`, { token: kitchen });
  check(
    'le restaurant ne peut pas la confirmer avant le paiement',
    early.status >= 400,
    `HTTP ${early.status}`,
  );
  const ref = `CIA${Date.now()}`;
  const claim = await call('POST', `/payments/${pay.body.payment.id}/mobile-money/claim`, {
    token: cust,
    body: { transactionRef: ref, payerPhone: CUSTOMER },
  });
  check('numéro saisi avant réception : toujours en attente', claim.body?.outcome === 'pending');
  check('toujours invisible pour le restaurant', !(await board(kitchen)).includes(order.id));
  const rec = await recordTransfer(staff, {
    amountMinor: order.total.minor,
    ref,
    sender: CUSTOMER,
  });
  check('transfert reçu et rapproché', rec.body?.matchedPaymentId === pay.body.payment.id);
  check('paiement réussi', paymentStatus(order.id) === 'succeeded');
  check('commande envoyée au restaurant', orderStatus(order.id) === 'placed');
  check('le restaurant la voit', (await board(kitchen)).includes(order.id));
  const ok = await call('POST', `/orders/${order.id}/confirm`, { token: kitchen });
  check(
    'le restaurant peut la confirmer',
    ok.status === 200 || ok.status === 201,
    `HTTP ${ok.status}`,
  );
  await call('POST', `/orders/${order.id}/reject`, {
    token: kitchen,
    body: { reason: 'fin du test A' },
  });
}

// ── B. App + cash: nothing up front, confirmed at delivery ──────────────────
{
  console.log('\nB. Application + espèces : rien à payer avant, confirmé à la livraison');
  const cust = await login(CUSTOMER);
  const { order } = await cartOrder(cust);
  const methods = (await call('GET', `/payments/methods-for-order/${order.id}`, { token: cust }))
    .body;
  const cash = methods.find((m) => m.capabilities.collectedOnDelivery);
  await call('POST', '/payments', {
    token: cust,
    body: { orderId: order.id, providerCode: cash.providerCode, methodCode: cash.methodCode },
  });
  check('commande envoyée au restaurant tout de suite', orderStatus(order.id) === 'placed');
  check('le restaurant la voit', (await board(kitchen)).includes(order.id));
  check('paiement espèces en attente (rien payé)', paymentStatus(order.id) === 'pending');
  const d = await deliver(order.id, {
    kitchen,
    courier,
    code: async (did) => (await call('GET', `/deliveries/${did}/code`, { token: cust })).body.code,
  });
  check('toujours non payé juste avant la livraison', d.before === 'pending');
  check('livrée avec le code du client', d.delivered, d.why ?? `HTTP ${d.status}`);
  check('payée une fois livrée (le livreur a encaissé)', paymentStatus(order.id) === 'succeeded');
  check('commande livrée', orderStatus(order.id) === 'delivered');
}

// ── C. Phone + Airtel: the operator orders, gives the code ──────────────────
{
  console.log('\nC. Appel téléphonique + Airtel Money : le standardiste commande');
  const menu = (await call('GET', '/restaurants/chez-fatime/menu')).body;
  const poulet = menu.flatMap((c) => c.products).find((p) => /Poulet/.test(p.name));
  const detail = (await call('GET', `/products/${poulet.id}`)).body;
  const opts = detail.optionGroups
    .filter((g) => g.isRequired)
    .map((g) => g.options.find((o) => o.isAvailable).id);
  const key = randomUUID();
  const placed = await call('POST', '/admin/phone-orders', {
    token: staff,
    idem: key,
    body: {
      customerPhone: CALLER,
      customerName: 'Client Téléphone',
      items: [{ productId: poulet.id, quantity: 1, selectedOptionIds: opts }],
      address: { quartier: 'Moursal', landmark: 'derrière la grande mosquée' },
      payment: { method: 'wallet', providerCode: 'airtel_money' },
    },
  });
  const order = placed.body?.order;
  check('commande prise par le standardiste', placed.status === 201, `HTTP ${placed.status}`);
  check(
    'code à donner au livreur fourni',
    /^\d{4}$/.test(placed.body?.deliveryCode ?? ''),
    placed.body?.deliveryCode,
  );
  check(
    'consignes Airtel à lire au client',
    /Envoyez/.test(placed.body?.payment?.instructions ?? ''),
    placed.body?.payment?.instructions,
  );
  check('la commande attend le paiement', orderStatus(order.id) === 'awaiting_payment');
  check('le restaurant ne la voit pas encore', !(await board(kitchen)).includes(order.id));
  const again = await call('POST', '/admin/phone-orders', {
    token: staff,
    idem: key,
    body: {
      customerPhone: CALLER,
      customerName: 'Client Téléphone',
      items: [{ productId: poulet.id, quantity: 1, selectedOptionIds: opts }],
      address: { quartier: 'Moursal', landmark: 'derrière la grande mosquée' },
      payment: { method: 'wallet', providerCode: 'airtel_money' },
    },
  });
  check(
    'double clic : même commande, même code',
    again.body?.order?.id === order.id && again.body?.deliveryCode === placed.body.deliveryCode,
  );
  const ref = `CIC${Date.now()}`;
  await recordTransfer(staff, { amountMinor: order.total.minor, ref, sender: CALLER });
  const confirm = await call('POST', `/admin/phone-orders/${order.id}/transfer`, {
    token: staff,
    body: { transactionRef: ref },
  });
  check(
    'le standardiste saisit le numéro de transaction : payé',
    confirm.body?.transfer === 'paid',
    JSON.stringify(confirm.body?.transfer),
  );
  check('commande envoyée au restaurant', orderStatus(order.id) === 'placed');
  check('le restaurant la voit', (await board(kitchen)).includes(order.id));
  const d = await deliver(order.id, {
    kitchen,
    courier,
    code: async () => placed.body.deliveryCode,
  });
  check('livrée avec le code donné au téléphone', d.delivered, d.why ?? `HTTP ${d.status}`);
  check('commande livrée', orderStatus(order.id) === 'delivered');
  const wrong = await call('POST', '/admin/phone-orders', {
    token: courier,
    idem: randomUUID(),
    body: {
      customerPhone: CALLER,
      items: [{ productId: poulet.id, quantity: 1, selectedOptionIds: opts }],
      address: { quartier: 'Moursal', landmark: 'derrière la grande mosquée' },
    },
  });
  check(
    'un livreur ne peut pas passer de commande téléphonique',
    wrong.status === 403,
    `HTTP ${wrong.status}`,
  );
}

console.log(failed === 0 ? '\nTOUT EST VERT' : `\n${failed} ÉCHEC(S)`);
process.exit(failed === 0 ? 0 : 1);
