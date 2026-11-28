#!/usr/bin/env node
// Full customer journey against a REAL running API + worker (docs/36's 19 pilot
// steps, plus the free WhatsApp login FEAT-023, cash and Airtel payment FEAT-009, courier
// cash FEAT-010). Report: docs/pipeline/customer-journey-2026-11-07.md.
//
//   node scripts/e2e/customer-journey.mjs cash|airtel
//
// Needs: a freshly seeded database, the API with WHATSAPP_PROVIDER=mock and the
// E2E_* values below, MOBILE_MONEY_WALLETS=airtel_money=…, airtel_money enabled
// (payment_providers.active + payment_provider_configs.enabled), the worker, and
// the restaurant open at the time of the run. Dev/CI only: it reads mock codes in Redis.
import { createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { io } = require('socket.io-client');
const { execSync } = require('node:child_process');

const MODE = process.argv[2] ?? 'cash';
const BASE = process.env.E2E_API_URL ?? 'http://localhost:3101';
const API = `${BASE}/v1`;
const WA_SECRET = process.env.E2E_WHATSAPP_APP_SECRET ?? 'demo-app-secret'; // same value as the API's WHATSAPP_APP_SECRET
const WA_PHONE_NUMBER_ID = process.env.E2E_WHATSAPP_PHONE_NUMBER_ID ?? '100000000000001';
const REDIS_PORT = process.env.E2E_REDIS_PORT ?? '56379';
const PG = process.env.E2E_PSQL ?? '-h 127.0.0.1 -p 55432 -U djafat -d djafat';
const results = [];
let failed = 0;
const step = (n, name, ok, detail = '') => {
  results.push({ n, name, ok, detail });
  if (!ok) failed++;
  console.log(
    `${ok ? '✅' : '❌'} ${String(n).padStart(2)} ${name}${detail ? ' — ' + detail : ''}`,
  );
};
const redis = (cmd) => execSync(`redis-cli -p ${REDIS_PORT} ${cmd}`).toString().trim();
const sql = (q) => execSync(`psql ${PG} -tAc "${q}"`).toString().trim();
async function call(method, path, { token, body, idem, expect } = {}) {
  const headers = body === undefined ? {} : { 'content-type': 'application/json' }; // like packages/sdk
  if (token) headers.authorization = `Bearer ${token}`;
  if (idem) headers['idempotency-key'] = idem;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}
async function smsLogin(phone) {
  await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  const code = redis(`get otp:mock:${phone}`);
  return (await call('POST', '/auth/otp/verify', { body: { phone, code, purpose: 'login' } })).body;
}
async function waitFor(fn, ms = 60000, every = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, every));
  }
  return null;
}

// ── 1. Login by WhatsApp (FEAT-023): the screen shows a code, the customer SENDS it,
//       the screen is signed in — DJAFAT sends nothing on WhatsApp ──
const CUSTOMER = '+23566000001';
const methods = await call('GET', '/auth/methods');
const wa = methods.body?.methods?.find((m) => m.id === 'whatsapp');
const started = await call('POST', '/auth/whatsapp/start', { body: {} });
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: '23560000001', phone_number_id: WA_PHONE_NUMBER_ID },
            messages: [
              {
                from: CUSTOMER.slice(1),
                id: `wamid.${randomUUID()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: started.body?.text ?? '' },
              },
            ],
          },
        },
      ],
    },
  ],
});
const sig = 'sha256=' + createHmac('sha256', WA_SECRET).update(body).digest('hex');
const hook = await fetch(`${API}/auth/whatsapp/webhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
  body,
});
const login = (await waitFor(
  async () => {
    const r = await call('POST', '/auth/whatsapp/status', {
      body: { token: started.body?.token },
    });
    return r.body?.status === 'waiting' ? null : r;
  },
  5000,
  300,
)) ?? { status: 0, body: null };
const TOK = login.body?.access;
step(
  1,
  'Connexion WhatsApp (code affiché → message du client → session)',
  !!wa?.available &&
    started.status === 201 &&
    hook.status === 200 &&
    login.status === 200 &&
    login.body?.status === 'signed_in' &&
    login.body?.user?.roles?.includes('customer'),
  `méthodes=${methods.body?.methods?.map((m) => m.id + (m.available ? '✓' : '✗')).join(',')} start=${started.status} webhook=${hook.status} status=${login.body?.status}`,
);

// ── 2-3. Restaurant and menu ──
const list = await call('GET', '/restaurants');
const rest = await call('GET', '/restaurants/chez-fatime');
const items = list.body?.items ?? list.body?.restaurants ?? list.body ?? [];
step(
  2,
  'Choix du restaurant',
  list.status === 200 && rest.status === 200 && rest.body?.availability === 'OPEN',
  `${Array.isArray(items) ? items.length : '?'} restaurants ; chez-fatime ${rest.body?.availability}`,
);
const menu = await call('GET', '/restaurants/chez-fatime/menu');
const cats = Array.isArray(menu.body) ? menu.body : (menu.body?.categories ?? []);
const products = cats.flatMap((c) => c.products ?? []);
const poulet = products.find((p) => p.name === 'Poulet braisé');
const frites = products.find((p) => p.name === 'Frites');
step(
  3,
  'Menu',
  menu.status === 200 && products.some((p) => p.isAvailable) && !!poulet && !!frites,
  `${cats.length} catégories, ${products.length} produits`,
);

// ── 4-5. Cart with options ──
const pouletDetail = (await call('GET', `/products/${poulet?.id}`)).body;
const portion = pouletDetail?.optionGroups?.find((g) => g.name === 'Portion');
const entier = portion?.options?.find((o) => o.name === 'Entier');
const add1 = await call('POST', '/carts/items', {
  token: TOK,
  body: { productId: poulet?.id, quantity: 2, selectedOptionIds: entier ? [entier.id] : [] },
});
const add2 = await call('POST', '/carts/items', {
  token: TOK,
  body: { productId: frites?.id, quantity: 1, selectedOptionIds: [] },
});
step(
  4,
  'Ajout produit + options',
  add1.status === 201 && add2.status === 201,
  `poulet ×2 (Entier) : ${add1.status}, frites : ${add2.status}`,
);
const cart = await call('GET', '/carts', { token: TOK });
const cartItems = cart.body?.items ?? cart.body?.cart?.items ?? [];
step(
  5,
  'Panier',
  cart.status === 200 &&
    cartItems.length === 2 &&
    cartItems.find((i) => i.name === 'Poulet braisé')?.quantity === 2,
  `${cartItems.length} lignes`,
);

// ── 6-7. Address and quote ──
const addr = await call('GET', '/users/me/addresses', { token: TOK });
const addrs = addr.body?.items ?? addr.body?.addresses ?? addr.body ?? [];
step(
  6,
  'Adresse de livraison',
  addr.status === 200 && Array.isArray(addrs) && addrs.some((a) => a.isDefault),
  `${Array.isArray(addrs) ? addrs.length : '?'} adresse(s)`,
);
const quote = await call('POST', '/carts/quote', { token: TOK });
const q = quote.body;
const qOk =
  quote.status === 201 &&
  BigInt(q?.total?.minor ?? -1) ===
    BigInt(q?.subtotal?.minor ?? 0) + BigInt(q?.deliveryFee?.minor ?? 0);
step(
  7,
  'Devis',
  qOk,
  `sous-total ${q?.subtotal?.minor} + livraison ${q?.deliveryFee?.minor} = ${q?.total?.minor} XAF`,
);

// ── 8. Order, idempotent ──
const idem = randomUUID();
const o1 = await call('POST', '/orders', { token: TOK, idem, body: {} });
const o2 = await call('POST', '/orders', { token: TOK, idem, body: {} });
const order = o1.body?.order;
const OID = order?.id;
step(
  8,
  'Création de la commande (rejouée avec la même clé)',
  o1.status === 201 &&
    o2.body?.status === 'replayed' &&
    o2.body?.order?.id === OID &&
    order?.total?.minor === q?.total?.minor,
  `${order?.code} ${order?.status}, rejeu=${o2.body?.status}`,
);

// ── 9. Realtime ──
const events = [];
const sock = io(`${BASE}/rt`, { auth: { token: TOK }, transports: ['websocket'] });
await new Promise((r) => {
  sock.on('connect', r);
  setTimeout(r, 5000);
});
sock.onAny((ev, payload) =>
  events.push({ ev, status: payload?.status ?? payload?.toStatus ?? payload?.payload?.status }),
);
sock.on('disconnect', (reason) => events.push({ ev: `DISCONNECT(${reason})` }));
sock.emit('subscribe', { room: `order:${OID}` });
await new Promise((r) => setTimeout(r, 800));

// ── Payment ──
let payment;
if (MODE === 'cash') {
  payment = await call('POST', '/payments', {
    token: TOK,
    idem: randomUUID(),
    body: { orderId: OID, providerCode: 'cash', methodCode: 'cash_on_delivery' },
  });
  step(
    'P',
    'Paiement espèces à la livraison',
    payment.status === 201 && payment.body?.payment?.status === 'pending',
    `paiement ${payment.body?.payment?.status}`,
  );
} else {
  payment = await call('POST', '/payments', {
    token: TOK,
    idem: randomUUID(),
    body: {
      orderId: OID,
      providerCode: 'airtel_money',
      methodCode: 'mobile_money',
      payerPhone: '66 00 00 01',
    },
  });
  const instr = payment.body?.payment?.action?.instructions ?? '';
  const PID = payment.body?.payment?.id;
  const ref = `AM${Date.now()}`;
  const claim = await call('POST', `/payments/${PID}/mobile-money/claim`, {
    token: TOK,
    body: { transactionRef: ref },
  });
  const SUP = (await smsLogin('+23566000005')).access;
  const rec = await call('POST', '/payments/mobile-money/receipts', {
    token: SUP,
    body: {
      providerCode: 'airtel_money',
      transactionRef: ref,
      amount: { minor: q.total.minor, currency: 'XAF' },
      senderPhone: '66 00 00 01',
      receivedAt: new Date().toISOString(),
    },
  });
  const paid = await waitFor(
    async () =>
      (await call('GET', `/payments/${PID}`, { token: TOK })).body?.status === 'succeeded',
    5000,
    300,
  );
  step(
    'P',
    "Paiement Airtel d'avance (instructions → n° de transaction → transfert enregistré)",
    payment.status === 201 &&
      instr.includes('FCFA') &&
      claim.body?.outcome === 'pending' &&
      rec.body?.matchedPaymentId === PID &&
      !!paid,
    `instructions="${instr.slice(0, 60)}…" réclamation=${claim.body?.outcome} rapprochement=${rec.body?.matchedPaymentId === PID}`,
  );
}
const placed = await waitFor(
  async () => sql(`select status from orders where id='${OID}'`) === 'placed',
  5000,
  300,
);
step(
  'P2',
  'Commande passée au restaurant',
  !!placed,
  sql(`select status from orders where id='${OID}'`),
);

// ── 10-13. Restaurant ──
const STAFF = (await smsLogin('+23566000004')).access;
const board = await call('GET', '/orders', { token: STAFF });
const boardItems = board.body?.items ?? board.body?.orders ?? board.body ?? [];
step(
  10,
  'Réception par le restaurant',
  board.status === 200 &&
    Array.isArray(boardItems) &&
    boardItems.some((x) => x.id === OID && x.status === 'placed'),
  `${Array.isArray(boardItems) ? boardItems.length : '?'} commande(s) au tableau`,
);
const conf = await call('POST', `/orders/${OID}/confirm`, { token: STAFF, idem: randomUUID() });
step(
  11,
  'Acceptation',
  conf.status === 200 && conf.body?.status === 'confirmed',
  conf.body?.status ?? JSON.stringify(conf.body).slice(0, 120),
);
const ready = await call('POST', `/orders/${OID}/ready`, { token: STAFF, idem: randomUUID() });
const hist = sql(
  `select string_agg(to_status::text, '>' order by created_at) from order_status_history where order_id='${OID}'`,
);
step(12, 'Préparation (automatique)', hist.includes('preparing'), hist);
step(
  13,
  'Prête (déclenche la recherche de livreur)',
  ready.status === 200 && ready.body?.status === 'ready',
  ready.body?.status,
);

// ── 14-16. Courier ──
const COUR = (await smsLogin('+23566000002')).access;
await call('POST', '/couriers/me/status', { token: COUR, body: { status: 'online' } });
await call('POST', '/couriers/me/location', {
  token: COUR,
  body: { lat: 12.1348, lng: 15.0557, accuracyM: 10 },
});
const offer = await waitFor(
  async () => {
    const r = await call('GET', '/couriers/me/offers', { token: COUR });
    const list2 = r.body?.items ?? r.body?.offers ?? r.body ?? [];
    return Array.isArray(list2) ? (list2.find((x) => x.context?.orderId === OID) ?? null) : null;
  },
  90000,
  2000,
);
const DID =
  offer?.deliveryId ??
  offer?.delivery?.id ??
  sql(`select id from deliveries where order_id='${OID}'`);
const acc = await call('POST', `/deliveries/${DID}/accept`, { token: COUR, idem: randomUUID() });
step(
  14,
  'Offre au livreur + acceptation',
  !!offer && acc.status === 200,
  `offre=${!!offer} restaurant="${offer?.context?.restaurantName ?? '?'}" accept=${acc.status} ${JSON.stringify(acc.body?.error ?? '').slice(0, 160)}`,
);
const pick = await call('POST', `/deliveries/${DID}/pickup`, { token: COUR, idem: randomUUID() });
const courierAsks = await call('GET', `/deliveries/${DID}/code`, { token: COUR });
const codeR = await call('GET', `/deliveries/${DID}/code`, { token: TOK });
const code = codeR.body?.code ?? codeR.body?.proofCode;
const wrong = await call('POST', `/deliveries/${DID}/deliver`, {
  token: COUR,
  idem: randomUUID(),
  body: { proofCode: code === '0000' ? '1111' : '0000' },
});
step(
  15,
  'Récupération + code client (livreur refusé, mauvais code refusé)',
  pick.status === 200 &&
    courierAsks.status === 403 &&
    /^\d{4}$/.test(code ?? '') &&
    wrong.status === 409,
  `pickup=${pick.status} livreur→code=${courierAsks.status} mauvais code=${wrong.status} ${wrong.body?.error?.code ?? ''}`,
);
const dl = await call('POST', `/deliveries/${DID}/deliver`, {
  token: COUR,
  idem: randomUUID(),
  body: { proofCode: code },
});
const payDone = await waitFor(
  async () =>
    sql(`select status from payments where order_id='${OID}' and status='succeeded'`) ===
    'succeeded',
  8000,
  300,
);
step(
  16,
  'Livrée',
  dl.status === 200 &&
    sql(`select status from deliveries where id='${DID}'`) === 'delivered' &&
    sql(`select status from orders where id='${OID}'`) === 'delivered',
  `livraison=${sql(`select status from deliveries where id='${DID}'`)} commande=${sql(`select status from orders where id='${OID}'`)}`,
);

// ── 17-19. Final state, history, wallets, ledger ──
const fin = await call('GET', `/orders/${OID}`, { token: TOK });
step(
  17,
  'État final (montants jamais recalculés)',
  fin.body?.status === 'delivered' && fin.body?.total?.minor === q.total.minor && !!payDone,
  `total ${fin.body?.total?.minor} = devis ${q.total.minor} ; paiement ${sql(`select status from payments where order_id='${OID}'`)}`,
);
const mine = await call('GET', '/orders/mine', { token: TOK });
const mineItems = mine.body?.items ?? mine.body?.orders ?? mine.body ?? [];
const other = await smsLogin('+23599111222').catch(() => null); // a brand-new customer (account created at login)
const otherGet = other?.access
  ? await call('GET', `/orders/${OID}`, { token: other.access })
  : { status: 'n/a' };
step(
  18,
  'Historique (un autre client ne la voit jamais)',
  mine.status === 200 &&
    Array.isArray(mineItems) &&
    mineItems.some((x) => x.id === OID) &&
    [403, 404].includes(otherGet.status),
  `historique=${mineItems.length} autre client=${otherGet.status}`,
);
const rb = await call('GET', '/restaurants/me/balance', { token: STAFF });
const cb = await call('GET', '/couriers/me/balance', { token: COUR });
const unbalanced = sql(
  `select count(*) from (select g.id from ledger_entry_groups g join ledger_entries e on e.entry_group=g.id where g.order_id='${OID}' group by g.id having sum(case when e.direction='debit' then e.amount_minor else -e.amount_minor end) <> 0) x`,
);
const groups = sql(
  `select string_agg(kind::text, ',' order by posted_at) from ledger_entry_groups where order_id='${OID}'`,
);
step(
  19,
  'Portefeuilles + grand livre équilibré',
  rb.status === 200 && cb.status === 200 && unbalanced === '0',
  `restaurant=${rb.status} livreur=${cb.status} groupes=${groups} déséquilibrés=${unbalanced}`,
);
const cash = await call('GET', '/couriers/me/cash', { token: COUR });
step(
  'C',
  'Espèces détenues par le livreur',
  cash.status === 200,
  `détenu ${cash.body?.held?.minor} / plafond ${cash.body?.ceiling?.minor} / bloqué ${cash.body?.blocked}`,
);

// the worker relays the outbox every 2 s: wait for the final events before closing
await waitFor(async () => events.some((e) => e.ev === 'order.delivered'), 15000, 300);
sock.close();
const seen = [...new Set(events.map((e) => e.status).filter(Boolean))];
console.log('EVENTS', events.map((e) => e.ev + (e.status ? ':' + e.status : '')).join(' | '));
step(
  9,
  'Suivi en temps réel (événements reçus par le client)',
  events.length > 0 &&
    !events.some((e) => e.ev.startsWith('DISCONNECT') && !e.ev.includes('io client disconnect')) &&
    events.some((e) => e.status === 'delivered'),
  `${events.length} événements : ${seen.join(' > ')}`,
);

console.log(
  `\n${MODE.toUpperCase()} : ${results.length - failed}/${results.length} étapes réussies`,
);
process.exit(failed ? 1 : 0);
