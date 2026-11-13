#!/usr/bin/env node
// Landmarks, learned delivery point and voice note, against a REAL running API (FEAT-018).
//
//   node scripts/e2e/landmarks.mjs
//
// The customer finds « Grande Mosquée », places the address behind it with
// « portail bleu », records a voice note, and orders (paid by Airtel). The
// courier sees the sentence, hears the note (another courier cannot), and
// confirms the delivery standing at the real door with a precise GPS fix:
// the address learns that point. The next order to it sends the courier
// there; the first order is unchanged.
//
// Needs: a freshly seeded database (migration 0037 + landmarks seed), the API
// with SMS_PROVIDER=http to the mock SMS inbox, airtel_money enabled, the
// worker, and the restaurant open. Dev/CI only.
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

const API = `${process.env.E2E_API_URL ?? 'http://localhost:3101'}/v1`;
const INBOX = process.env.E2E_SMS_INBOX ?? 'http://localhost:4020/messages';
const REDIS_PORT = process.env.E2E_REDIS_PORT ?? '56379';
const PG = process.env.E2E_PSQL ?? '-h 127.0.0.1 -p 55432 -U djafat -d djafat';
const CUSTOMER = '+23566000001';
const COURIER = '+23566000002';
const RESTAURANT = '+23566000004';
const FINANCE = '+23566000006';
// the real door, ~150 m from the landmark
const DOOR = { lat: 12.1077, lng: 15.0446 };

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

/** Cart → order to `addressId`, paid by Airtel, transfer recorded by finance: order placed. */
async function paidOrder(cust, finance, addressId) {
  const menu = (await call('GET', '/restaurants/chez-fatime/menu')).body;
  const poulet = menu.flatMap((c) => c.products).find((p) => /Poulet/.test(p.name));
  const detail = (await call('GET', `/products/${poulet.id}`)).body;
  const opts = detail.optionGroups
    .filter((g) => g.isRequired)
    .map((g) => g.options.find((o) => o.isAvailable).id);
  await call('DELETE', '/carts', { token: cust });
  await call('POST', '/carts/items', {
    token: cust,
    body: { productId: poulet.id, quantity: 1, selectedOptionIds: opts, replaceCart: true },
  });
  const order = (await call('POST', '/orders', { token: cust, body: { addressId } })).body.order;
  const pay = await call('POST', '/payments', {
    token: cust,
    body: {
      orderId: order.id,
      providerCode: 'airtel_money',
      methodCode: 'mobile_money',
      payerPhone: CUSTOMER,
    },
  });
  const ref = `LM${Date.now()}`;
  await call('POST', `/payments/${pay.body.payment.id}/mobile-money/claim`, {
    token: cust,
    body: { transactionRef: ref, payerPhone: CUSTOMER },
  });
  await call('POST', '/payments/mobile-money/receipts', {
    token: finance,
    body: {
      providerCode: 'airtel_money',
      transactionRef: ref,
      amount: order.total,
      senderPhone: CUSTOMER,
      receivedAt: new Date().toISOString(),
    },
  });
  await waitFor(() => sql(`select status from orders where id='${order.id}'`) === 'placed', 20000);
  return order;
}

async function main() {
  const cust = await login(CUSTOMER);
  const courier = await login(COURIER);
  const kitchen = await login(RESTAURANT);
  const finance = await login(FINANCE);

  // 1. Landmark search, accents and case ignored.
  const found = (await call('GET', '/landmarks?q=MOSQUEE')).body ?? [];
  const mosque = found.find((l) => /Grande Mosquée/.test(l.name));
  check('« MOSQUEE » finds « Grande Mosquée »', !!mosque, found.map((l) => l.name).join(', '));

  // 2. An address behind it, with a door hint, no pin.
  const created = await call('POST', '/users/me/addresses', {
    token: cust,
    body: {
      label: 'Chez Awa',
      quartier: 'Centre-ville',
      landmarkId: mosque.id,
      landmarkRelation: 'behind',
      doorHint: 'portail bleu',
    },
  });
  const address = created.body;
  check(
    'address placed against the landmark',
    created.status === 201 &&
      address.deliveryHint === `Derrière ${mosque.name} — portail bleu` &&
      address.geomSource === 'landmark' &&
      Math.abs(address.lat - mosque.lat) < 1e-6,
    `${address.deliveryHint} · ${address.geomSource}`,
  );

  // 3. A voice note (≈ 3 KB of audio bytes), and the limits.
  const note = Buffer.alloc(3000, 7).toString('base64');
  const put = await call('PUT', `/users/me/addresses/${address.id}/voice-note`, {
    token: cust,
    body: { mime: 'audio/webm', dataBase64: note, durationMs: 6000 },
  });
  check('voice note saved', put.status === 200 && put.body.hasVoiceNote === true);
  const tooLong = await call('PUT', `/users/me/addresses/${address.id}/voice-note`, {
    token: cust,
    body: { mime: 'audio/webm', dataBase64: note, durationMs: 15000 },
  });
  check('a note over 10 s is refused', tooLong.status === 422);

  // 4. Order to it; the restaurant prepares; the courier is offered it.
  const first = await paidOrder(cust, finance, address.id);
  check(
    'order placed (paid by Airtel)',
    sql(`select status from orders where id='${first.id}'`) === 'placed',
  );
  check(
    'the order keeps the landmark sentence and the door hint',
    sql(`select dropoff_landmark||' | '||dropoff_door_hint from orders where id='${first.id}'`) ===
      `Derrière ${mosque.name} | portail bleu`,
  );
  const [rlat, rlng] = sql(
    `select ST_Y(geom::geometry)||' '||ST_X(geom::geometry) from restaurants where slug='chez-fatime'`,
  )
    .split(' ')
    .map(Number);
  await call('POST', '/couriers/me/status', { token: courier, body: { status: 'online' } });
  await call('POST', '/couriers/me/location', {
    token: courier,
    body: { lat: rlat + 0.002, lng: rlng, accuracyM: 10 },
  });
  await call('POST', `/orders/${first.id}/confirm`, { token: kitchen });
  await call('POST', `/orders/${first.id}/ready`, { token: kitchen });
  const did = await waitFor(
    () =>
      sql(
        `select d.id from deliveries d join delivery_offers o on o.delivery_id=d.id where d.order_id='${first.id}' and o.status='offered'`,
      ) || null,
  );
  await call('POST', `/deliveries/${did}/accept`, { token: courier });

  // 5. The courier sees the sentence and hears the note; a stranger cannot.
  const mine = (await call('GET', '/couriers/me/deliveries', { token: courier })).body ?? [];
  const ctx = mine.find((d) => d.id === did)?.context ?? {};
  check(
    'courier sees landmark, door hint and that there is a note',
    /Derrière Grande Mosquée/.test(ctx.dropoffAddress ?? '') &&
      ctx.dropoffDoorHint === 'portail bleu' &&
      ctx.dropoffHasVoiceNote === true,
    `${ctx.dropoffAddress} · ${ctx.dropoffDoorHint}`,
  );
  const heard = await call('GET', `/couriers/me/deliveries/${did}/voice-note`, { token: courier });
  check('the courier hears the note', heard.status === 200 && heard.body?.dataBase64 === note);
  const other = await call('GET', `/couriers/me/deliveries/${did}/voice-note`, { token: finance });
  check(
    'anyone else is refused',
    other.status === 403 || other.status === 404,
    `HTTP ${other.status}`,
  );

  // 6. Pickup, then delivery confirmed AT THE REAL DOOR with a precise fix.
  await call('POST', `/deliveries/${did}/pickup`, { token: courier });
  await call('POST', '/couriers/me/location', {
    token: courier,
    body: { lat: DOOR.lat, lng: DOOR.lng, accuracyM: 8 },
  });
  const proof = (await call('GET', `/deliveries/${did}/code`, { token: cust })).body.code;
  const done = await call('POST', `/deliveries/${did}/deliver`, {
    token: courier,
    body: { proofCode: proof },
  });
  check('delivered with the code', done.status === 200 || done.status === 201);
  const learned = await waitFor(async () => {
    const a = (await call('GET', `/users/me/addresses/${address.id}`, { token: cust })).body;
    return a?.learnedPoint ? a : null;
  }, 10000);
  check(
    'the address learned the door point from the courier',
    !!learned &&
      Math.abs(learned.learnedPoint.lat - DOOR.lat) < 1e-6 &&
      learned.learnedPoint.count === 1,
    learned ? JSON.stringify(learned.learnedPoint) : 'not learned',
  );

  // 7. The next order goes to the learned point; the first one is unchanged.
  const second = await paidOrder(cust, finance, address.id);
  const at = (id) =>
    sql(
      `select round(ST_Y(dropoff_geom::geometry)::numeric,6)||' '||round(ST_X(dropoff_geom::geometry)::numeric,6) from orders where id='${id}'`,
    );
  check(
    'next order is sent to the learned door',
    at(second.id) === `${DOOR.lat.toFixed(6)} ${DOOR.lng.toFixed(6)}`,
    at(second.id),
  );
  check(
    'the first order is unchanged (still the landmark point)',
    at(first.id) === `${mosque.lat.toFixed(6)} ${mosque.lng.toFixed(6)}`,
    at(first.id),
  );

  console.log(failed ? `\n${failed} échec(s)` : '\nTout est vert.');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
