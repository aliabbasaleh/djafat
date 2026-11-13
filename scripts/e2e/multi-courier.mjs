#!/usr/bin/env node
// Several couriers at once, against a REAL running API + worker (complement to
// customer-journey.mjs). Couriers are onboarded the way an admin does it: the
// admin logs in, enrols MFA, steps up, and grants the `courier` role.
//
//   node scripts/e2e/multi-courier.mjs
//
// Needs a freshly seeded database, the API + worker running, the restaurant
// open. Dev/CI only: it reads mock OTP codes in Redis.
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const { totpCodeAt } = require('@djafat/core');

const API = `${process.env.E2E_API_URL ?? 'http://localhost:3101'}/v1`;
const REDIS_PORT = process.env.E2E_REDIS_PORT ?? '56379';
const PG = process.env.E2E_PSQL ?? '-h 127.0.0.1 -p 55432 -U djafat -d djafat';
const redis = (cmd) => execSync(`redis-cli -p ${REDIS_PORT} ${cmd}`).toString().trim();
const sql = (q) => execSync(`psql ${PG} -tAc "${q}"`).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let total = 0;
const step = (name, ok, detail = '') => {
  total++;
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
};
async function call(method, path, { token, body, idem } = {}) {
  const headers = body === undefined ? {} : { 'content-type': 'application/json' };
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
async function login(phone) {
  // test-only: the dev OTP rate limits would otherwise stop a run with many logins
  for (const k of redis(`--scan --pattern ratelimit:otp:*`).split('\n').filter(Boolean))
    redis(`del ${k}`);
  await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  const code = redis(`get otp:mock:${phone}`);
  const r = await call('POST', '/auth/otp/verify', { body: { phone, code, purpose: 'login' } });
  return r.body;
}
async function waitFor(fn, ms, every = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

// ── Admin onboards 3 couriers (MFA step-up, role grant) ──
const admin = await login('+23566000007');
const ADM = admin.access;
const setup = await call('POST', '/auth/mfa/setup', { token: ADM });
const secret = setup.body?.secretBase32;
const enrol = await call('POST', '/auth/mfa/verify', {
  token: ADM,
  body: { code: await totpCodeAt(secret, Date.now()) },
});
await sleep(1100);
const stepUp = await call('POST', '/auth/mfa/verify', {
  token: ADM,
  body: { code: await totpCodeAt(secret, Date.now() + 30_000) },
});
const [pickupLat, pickupLng] = sql(
  `select ST_Y(geom::geometry)||' '||ST_X(geom::geometry) from restaurants where slug='chez-fatime'`,
)
  .split(' ')
  .map(Number);
// The seeded courier is set offline so the test controls exactly who is online.
const seeded = await login('+23566000002');
await call('POST', '/couriers/me/status', { token: seeded.access, body: { status: 'offline' } });
const couriers = [];
for (const [name, phone, metersNorth] of [
  ['A', '+23590000001', 200],
  ['B', '+23590000002', 700],
  ['C', '+23590000003', 1400],
]) {
  const first = await login(phone); // the account is created at first login
  const grant = await call('POST', `/admin/users/${first.user.id}/roles`, {
    token: ADM,
    body: { role: 'courier' },
  });
  const again = await login(phone); // fresh token carrying the new role
  couriers.push({
    name,
    phone,
    id: first.user.id,
    token: again.access,
    lat: pickupLat + metersNorth / 111_000,
    lng: pickupLng,
    grant: grant.status,
  });
}
step(
  'Admin crée 3 livreurs (MFA + rôle)',
  !!secret && enrol.status === 200 && couriers.every((c) => c.grant === 201),
  `mfa=${setup.status}/${enrol.status}/${stepUp.status} rôles=${couriers.map((c) => c.grant).join(',')}`,
);
const byId = Object.fromEntries(couriers.map((c) => [c.id, c.name]));
async function online(c) {
  await call('POST', '/couriers/me/status', { token: c.token, body: { status: 'online' } });
  await call('POST', '/couriers/me/location', {
    token: c.token,
    body: { lat: c.lat, lng: c.lng, accuracyM: 10 },
  });
}
async function refreshPositions() {
  for (const c of couriers)
    await call('POST', '/couriers/me/location', {
      token: c.token,
      body: { lat: c.lat, lng: c.lng, accuracyM: 10 },
    });
}
for (const c of couriers) await online(c);

// ── Customer + restaurant helpers ──
const TOK = (await login('+23566000001')).access;
const STAFF = (await login('+23566000004')).access;
const menu = (await call('GET', '/restaurants/chez-fatime/menu')).body;
const frites = menu.flatMap((c) => c.products).find((p) => p.name === 'Frites');
async function readyCashOrder() {
  await call('POST', '/carts/items', {
    token: TOK,
    body: { productId: frites.id, quantity: 1, selectedOptionIds: [] },
  });
  const o = (await call('POST', '/orders', { token: TOK, idem: randomUUID(), body: {} })).body
    .order;
  await call('POST', '/payments', {
    token: TOK,
    idem: randomUUID(),
    body: { orderId: o.id, providerCode: 'cash', methodCode: 'cash_on_delivery' },
  });
  await call('POST', `/orders/${o.id}/confirm`, { token: STAFF, idem: randomUUID() });
  await call('POST', `/orders/${o.id}/ready`, { token: STAFF, idem: randomUUID() });
  return {
    orderId: o.id,
    deliveryId: await waitFor(
      async () => sql(`select id from deliveries where order_id='${o.id}'`) || null,
      10000,
      300,
    ),
  };
}
const offeredTo = (deliveryId) =>
  sql(
    `select courier_id from delivery_offers where delivery_id='${deliveryId}' and status='offered'`,
  );
async function waitOffered(deliveryId, ms = 60000) {
  return waitFor(async () => offeredTo(deliveryId) || null, ms, 1000);
}
async function deliver(c, deliveryId) {
  await call('POST', `/deliveries/${deliveryId}/pickup`, { token: c.token, idem: randomUUID() });
  const code = (await call('GET', `/deliveries/${deliveryId}/code`, { token: TOK })).body?.code;
  return (
    await call('POST', `/deliveries/${deliveryId}/deliver`, {
      token: c.token,
      idem: randomUUID(),
      body: { proofCode: code },
    })
  ).status;
}
const C = (name) => couriers.find((c) => c.name === name);

// 1. nearest first
const d1 = await readyCashOrder();
const first = await waitOffered(d1.deliveryId);
step(
  "1. Le plus proche reçoit l'offre en premier",
  byId[first] === 'A',
  `offerte à ${byId[first] ?? first}`,
);
// 2. A rejects -> B
const rej = await call('POST', `/deliveries/${d1.deliveryId}/reject`, {
  token: C('A').token,
  idem: randomUUID(),
});
await refreshPositions();
const second = await waitFor(async () => {
  const o = offeredTo(d1.deliveryId);
  return o && o !== first ? o : null;
}, 60000);
step(
  '2. A refuse → le suivant (B) la reçoit',
  rej.status === 200 && byId[second] === 'B',
  `refus=${rej.status} puis offerte à ${byId[second] ?? second}`,
);
// 3. B ignores (timeout) -> C, never A again (it refused)
const t0 = Date.now();
const third = await waitFor(
  async () => {
    await refreshPositions();
    const o = offeredTo(d1.deliveryId);
    return o && o !== second ? o : null;
  },
  90000,
  3000,
);
step(
  '3. B ne répond pas → après expiration, C la reçoit (jamais A qui a refusé)',
  byId[third] === 'C',
  `offerte à ${byId[third] ?? third} après ${Math.round((Date.now() - t0) / 1000)} s`,
);
// 5. another courier cannot accept C's offer
const steal = await call('POST', `/deliveries/${d1.deliveryId}/accept`, {
  token: C('B').token,
  idem: randomUUID(),
});
step(
  "5. Un autre livreur ne peut pas accepter l'offre de C",
  [403, 409].includes(steal.status),
  `B → ${steal.status} ${steal.body?.error?.code ?? ''}`,
);
const accC = await call('POST', `/deliveries/${d1.deliveryId}/accept`, {
  token: C('C').token,
  idem: randomUUID(),
});
// 6. C is delivering: two new orders at once go to A and B, never C
await refreshPositions();
// one customer has one cart: two orders back to back, both waiting for a courier at the same time
const d2 = await readyCashOrder();
const d3 = await readyCashOrder();
const o2 = await waitOffered(d2.deliveryId);
const o3 = await waitOffered(d3.deliveryId);
step(
  '4. Deux commandes en même temps → deux livreurs différents',
  !!o2 && !!o3 && o2 !== o3,
  `${byId[o2]} et ${byId[o3]}`,
);
step(
  '6. Un livreur déjà en livraison (C) ne reçoit pas de 2ᵉ commande',
  accC.status === 200 && byId[o2] !== 'C' && byId[o3] !== 'C',
  `C accepte=${accC.status} ; offres → ${byId[o2]}, ${byId[o3]}`,
);
// finish all three
for (const [d, o] of [
  [d2, o2],
  [d3, o3],
])
  await call('POST', `/deliveries/${d.deliveryId}/accept`, {
    token: couriers.find((c) => c.id === o).token,
    idem: randomUUID(),
  });
const statuses = [
  await deliver(C('C'), d1.deliveryId),
  await deliver(
    couriers.find((c) => c.id === o2),
    d2.deliveryId,
  ),
  await deliver(
    couriers.find((c) => c.id === o3),
    d3.deliveryId,
  ),
];
const allDelivered = sql(
  `select count(*) from orders where id in ('${d1.orderId}','${d2.orderId}','${d3.orderId}') and status='delivered'`,
);
step(
  'Les 3 commandes sont livrées par 3 livreurs différents',
  statuses.every((s) => s === 200) && allDelivered === '3',
  `livraisons=${statuses.join(',')} livrées=${allDelivered}/3`,
);
// 7. cash-blocked courier skipped while others keep working
sql(
  `insert into platform_settings(key, scope, value) values ('courier_cash_ceiling_minor','global','1500'::jsonb) on conflict do nothing`,
);
sql(`update platform_settings set value='1500'::jsonb where key='courier_cash_ceiling_minor'`);
// each courier now holds 2 000 (one cash order) ≥ 1 500: re-evaluation happens on the next cash event,
// so deliver one more order with A to trigger it for A only.
await refreshPositions();
const d4 = await readyCashOrder();
const o4 = await waitOffered(d4.deliveryId);
await call('POST', `/deliveries/${d4.deliveryId}/accept`, {
  token: couriers.find((c) => c.id === o4).token,
  idem: randomUUID(),
});
await deliver(
  couriers.find((c) => c.id === o4),
  d4.deliveryId,
);
await sleep(1500);
const blocked = sql(
  `select string_agg(user_id::text, ',') from couriers where cash_blocked_at is not null`,
)
  .split(',')
  .filter(Boolean);
await refreshPositions();
const d5 = await readyCashOrder();
const o5 = await waitOffered(d5.deliveryId);
step(
  '7. Un livreur bloqué pour espèces est ignoré, les autres continuent',
  blocked.includes(o4) && !!o5 && o5 !== o4,
  `bloqué=${blocked.map((b) => byId[b] ?? b).join(',')} ; commande suivante → ${byId[o5] ?? o5}`,
);
const unbalanced = sql(
  `select count(*) from (select g.id from ledger_entry_groups g join ledger_entries e on e.entry_group=g.id group by g.id having sum(case when e.direction='debit' then e.amount_minor else -e.amount_minor end) <> 0) x`,
);
step(
  'Grand livre équilibré (toutes les écritures)',
  unbalanced === '0',
  `groupes déséquilibrés=${unbalanced}`,
);
console.log(`\nPLUSIEURS LIVREURS : ${total - failed}/${total} vérifications réussies`);
process.exit(failed ? 1 : 0);
