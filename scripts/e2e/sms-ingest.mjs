#!/usr/bin/env node
// Merchant SMS gateway against a REAL running API (FEAT-016).
//
//   node scripts/e2e/sms-ingest.mjs
//
// The API needs SMS_GATEWAY_ENCRYPTION_KEY. A customer pays by Airtel and
// gives the transaction number; a gateway phone forwards the operator's SMS,
// signed: the transfer is recorded and matched with no one typing it, and the
// order goes to the restaurant. A forged SMS (balance does not follow) is
// quarantined; a resend answers the same; a bad signature is refused.
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
import { createHmac, randomUUID } from 'node:crypto';
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

const admin = await login('+23566000007');
const cust = await login(CUSTOMER);

const reg = await call('POST', '/admin/sms-gateways', {
  token: admin,
  body: { providerCode: 'airtel_money', label: 'Téléphone Airtel test' },
});
check(
  'l’équipe enregistre le téléphone passerelle',
  reg.status === 201 && typeof reg.body?.secret === 'string',
  `HTTP ${reg.status}`,
);
const { id: deviceId, secret } = reg.body;

async function forward(seq, smsBody, { sign = secret } = {}) {
  const raw = JSON.stringify({
    seq,
    from: 'AirtelMoney',
    body: smsBody,
    receivedAt: new Date().toISOString(),
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac('sha256', sign).update(`${ts}.${raw}`).digest('hex');
  const res = await fetch(`${API}/payments/mobile-money/sms-gateways/${deviceId}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-djafat-timestamp': ts,
      'x-djafat-signature': sig,
    },
    body: raw,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

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
const ref = `CI${Date.now()}`;
await call('POST', `/payments/${pay.body.payment.id}/mobile-money/claim`, {
  token: cust,
  body: { transactionRef: ref, payerPhone: CUSTOMER },
});
check('la commande attend le paiement', orderStatus(order.id) === 'awaiting_payment');

const fmt = (n) =>
  BigInt(n)
    .toLocaleString('fr-FR')
    .replace(/\u202f|\u00a0/g, ' ');
const local = CUSTOMER.replace('+235', '');
const amount = BigInt(order.total.minor);
const sms1 = `Vous avez recu ${fmt(amount)} FCFA de ${local}. Trans ID: ${ref}. Nouveau solde: ${fmt(100000n + amount)} FCFA.`;
const r1 = await forward(1, sms1);
check(
  'SMS transmis : transfert enregistré et rapproché tout seul',
  r1.status === 200 &&
    r1.body?.outcome === 'recorded' &&
    r1.body?.matchedPaymentId === pay.body.payment.id,
  JSON.stringify(r1.body),
);
check(
  'paiement réussi, commande envoyée au restaurant',
  paymentStatus(order.id) === 'succeeded' && orderStatus(order.id) === 'placed',
);
check(
  'transfert marqué comme venant du téléphone passerelle',
  sql(`select source from mobile_money_receipts where transaction_ref='${ref}'`) ===
    'sms_forwarder',
);

const again = await forward(1, sms1);
check(
  'le même SMS renvoyé répond pareil, sans doublon',
  again.body?.outcome === 'recorded' &&
    sql(`select count(*) from mobile_money_receipts where transaction_ref='${ref}'`) === '1',
);
const forged = await forward(
  2,
  `Vous avez recu 50 000 FCFA de ${local}. Trans ID: FAUX${Date.now()}. Nouveau solde: 999 999 FCFA.`,
);
check(
  'un faux SMS (solde incohérent) est mis en quarantaine',
  forged.body?.outcome === 'quarantined',
  JSON.stringify(forged.body),
);
const bad = await forward(3, sms1, { sign: 'pas-le-bon-secret' });
check('une mauvaise signature est refusée', bad.status === 401, `HTTP ${bad.status}`);
const review = (await call('GET', '/admin/sms-gateways/review', { token: admin })).body;
check(
  'l’équipe voit le SMS en quarantaine',
  review.some((r) => r.outcome === 'quarantined'),
);
const devices = (await call('GET', '/admin/sms-gateways', { token: admin })).body;
check('le téléphone est vu comme actif', devices.find((d) => d.id === deviceId)?.silent === false);

console.log(failed === 0 ? '\nTOUT EST VERT' : `\n${failed} ÉCHEC(S)`);
process.exit(failed === 0 ? 0 : 1);
