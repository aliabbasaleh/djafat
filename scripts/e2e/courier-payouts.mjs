#!/usr/bin/env node
// Courier earnings and payouts against a REAL running API + worker (FEAT-014).
//
//   node scripts/e2e/courier-payouts.mjs
//
// A courier delivers 6 orders paid by Airtel and 1 paid in cash: earnings
// 7 000, cash owed 4 500 → net 2 500. They withdraw it; staff send it with a
// 100 FCFA Airtel fee: the cash owed is settled against the earnings, 2 400
// reach the courier, and the ledger stays balanced.
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
const admin = await login('+23566000007');

async function airtelOrder(cust) {
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
  const ref = `CIP${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await call('POST', `/payments/${pay.body.payment.id}/mobile-money/claim`, {
    token: cust,
    body: { transactionRef: ref, payerPhone: CUSTOMER },
  });
  await recordTransfer(staff, { amountMinor: order.total.minor, ref, sender: CUSTOMER });
  return order;
}
async function cashOrder(cust) {
  const { order } = await cartOrder(cust);
  const methods = (await call('GET', `/payments/methods-for-order/${order.id}`, { token: cust }))
    .body;
  const cash = methods.find((m) => m.capabilities.collectedOnDelivery);
  await call('POST', '/payments', {
    token: cust,
    body: { orderId: order.id, providerCode: cash.providerCode, methodCode: cash.methodCode },
  });
  return order;
}

console.log('\nGains et retraits du livreur');
let courier = await login(COURIER);
const before = (await call('GET', '/couriers/me/earnings', { token: courier })).body;
check('le livreur consulte ses gains', before?.week !== undefined && Array.isArray(before?.items));
let cashTotal = 0n;
for (let i = 0; i < 7; i++) {
  const cust = await login(CUSTOMER);
  const order = i === 6 ? await cashOrder(cust) : await airtelOrder(cust);
  if (i === 6) cashTotal = BigInt(order.total.minor);
  courier = await login(COURIER);
  const d = await deliver(order.id, {
    kitchen,
    courier,
    code: async (did) => (await call('GET', `/deliveries/${did}/code`, { token: cust })).body.code,
  });
  check(
    `course ${i + 1} livrée (${i === 6 ? 'espèces' : 'Airtel'})`,
    d.delivered,
    d.why ?? `HTTP ${d.status}`,
  );
}
courier = await login(COURIER);
const e = (await call('GET', '/couriers/me/earnings', { token: courier })).body;
const fee = (x) => BigInt(x.minor);
check('7 courses cette semaine', e.week.count - before.week.count === 7, `${e.week.count}`);
check(
  'gains de la semaine = somme des gains par course',
  fee(e.week.amount) === e.items.slice(0, e.week.count).reduce((s, i) => s + fee(i.fee), 0n),
  e.week.amount.minor,
);
check(
  'aucun montant de commande envoyé au livreur',
  !JSON.stringify(e).includes('"total"') && !JSON.stringify(e).includes('subtotal'),
);
check(
  'espèces à reverser = la commande en espèces',
  fee(e.balance.cashHeld) === cashTotal,
  e.balance.cashHeld.minor,
);
const net = fee(e.balance.available) - fee(e.balance.cashHeld);
check(
  'net = disponible − espèces',
  fee(e.balance.net) === net,
  `${e.balance.available.minor} − ${e.balance.cashHeld.minor} = ${e.balance.net.minor}`,
);

const req = await call('POST', '/couriers/me/payouts', { token: courier });
check(
  'retrait demandé du net',
  req.status === 201 && req.body.requested.minor === e.balance.net.minor,
  `HTTP ${req.status} ${req.body?.requested?.minor}`,
);
const again = await call('POST', '/couriers/me/payouts', { token: courier });
check(
  "pas de deuxième retrait pendant qu'un est en cours",
  again.status === 409,
  `HTTP ${again.status}`,
);
const forbidden = await call('GET', '/admin/payouts', { token: courier });
check(
  "un livreur ne voit pas la liste de l'équipe",
  forbidden.status === 403,
  `HTTP ${forbidden.status}`,
);
const list = (await call('GET', '/admin/payouts?status=requested', { token: admin })).body;
const mine = list.find((p) => p.id === req.body.id);
check("l'équipe voit le retrait avec le numéro du livreur", mine?.courier?.phone === COURIER);
const groupsBefore = Number(sql(`select count(*) from ledger_entry_groups`));
const sent = await call('POST', `/admin/payouts/${req.body.id}/sent`, {
  token: admin,
  body: { transactionRef: 'AMP-E2E-1', airtelFeeMinor: 100 },
});
check(
  'versement enregistré envoyé, frais déduits',
  sent.body?.status === 'sent' && BigInt(sent.body.received.minor) === net - 100n,
  JSON.stringify(sent.body?.received),
);
check(
  'deux groupes au grand livre (espèces soldées, versement)',
  Number(sql(`select count(*) from ledger_entry_groups`)) - groupsBefore === 2,
);
const resend = await call('POST', `/admin/payouts/${req.body.id}/sent`, {
  token: admin,
  body: { transactionRef: 'AMP-E2E-2', airtelFeeMinor: 0 },
});
check(
  "un même versement ne s'enregistre pas deux fois",
  resend.status === 409,
  `HTTP ${resend.status}`,
);
const after = (await call('GET', '/couriers/me/earnings', { token: courier })).body;
check(
  "après le versement : plus rien à recevoir, plus d'espèces dues",
  after.balance.net.minor === '0' && after.balance.cashHeld.minor === '0',
  JSON.stringify(after.balance),
);
const history = (await call('GET', '/couriers/me/payouts', { token: courier })).body;
check(
  'le livreur voit son versement envoyé avec le numéro',
  history[0]?.status === 'sent' && history[0]?.transactionRef === 'AMP-E2E-1',
);
const weekly = await call('POST', '/admin/payouts/weekly', { token: admin });
check(
  'versements du lundi : rien pour un livreur déjà payé',
  weekly.status === 200 && weekly.body.created === 0,
  JSON.stringify(weekly.body),
);
const unbalanced = sql(
  `select count(*) from (select entry_group, sum(case when direction='debit' then amount_minor else -amount_minor end) s from ledger_entries group by entry_group having sum(case when direction='debit' then amount_minor else -amount_minor end) <> 0) x`,
);
check('grand livre équilibré', unbalanced === '0', `groupes déséquilibrés=${unbalanced}`);

console.log(failed === 0 ? '\nTOUT EST VERT' : `\n${failed} ÉCHEC(S)`);
process.exit(failed === 0 ? 0 : 1);
