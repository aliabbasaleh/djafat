#!/usr/bin/env node
// FEAT-023 (SPEC-023-08 R4) — on a development machine, send the LOCAL API the
// WhatsApp message a customer would send to DJAFAT, signed like Meta signs it.
// There is no other way to finish a WhatsApp login without a Meta account.
//
//   node scripts/dev/whatsapp-message.mjs --from +33612345678 --code 482915
//   node scripts/dev/whatsapp-message.mjs --from +23566123456 --text "Je confirme mon numéro sur DJAFAT : 271804"
//
// --code writes the login message for you (the one the screen shows); --text
// sends any text. Reads WHATSAPP_APP_SECRET and WHATSAPP_PHONE_NUMBER_ID from
// the environment (export your .env first) and API_PUBLIC_URL (default
// http://localhost:3001). Refuses an API that is not on this machine: on a real
// server only Meta writes to the webhook. Prints no secret.
import { createHmac, randomUUID } from 'node:crypto';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

function fail(message) {
  console.error(`whatsapp-message: ${message}`);
  process.exit(1);
}

const from = args.get('--from') ?? '';
if (!/^\+\d{8,15}$/.test(from)) fail('--from must be an E.164 number, e.g. +23566123456');
const code = args.get('--code');
if (code !== undefined && !/^\d{6}$/.test(code))
  fail('--code must be the 6 digits shown on screen');
const text =
  args.get('--text') ??
  (code
    ? `Je me connecte à DJAFAT : ${code} (n'envoyez ce code que pour vous connecter vous-même)`
    : null);
if (!text) fail('give --code <6 digits> or --text "<message>"');

const api = new URL(args.get('--api') ?? process.env.API_PUBLIC_URL ?? 'http://localhost:3001');
if (!['localhost', '127.0.0.1', '[::1]'].includes(api.hostname)) {
  fail(`${api.host} is not this machine: only Meta writes to a real server's webhook`);
}
const secret = process.env.WHATSAPP_APP_SECRET;
const numberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
if (!secret || !numberId) {
  fail('WHATSAPP_APP_SECRET and WHATSAPP_PHONE_NUMBER_ID must be exported (see .env)');
}

// The shape of Meta's "messages" webhook (WhatsApp Cloud API).
const body = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: 'WABA-DEV',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { display_phone_number: 'dev', phone_number_id: numberId },
            messages: [
              {
                from: from.slice(1),
                id: `wamid.dev-${randomUUID()}`,
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
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
const path = `${api.pathname.replace(/\/$/, '').replace(/\/v1$/, '')}/v1/auth/whatsapp/webhook`;
const res = await fetch(new URL(path, api), {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
  body,
});
console.log(
  `whatsapp-message: ${from} → ${res.status === 200 ? 'received' : `HTTP ${res.status}`}`,
);
process.exit(res.status === 200 ? 0 : 1);
