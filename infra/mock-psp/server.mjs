// Minimal, dependency-free mock PSP for local dev / CI.
// Mirrors the MockPaymentProvider contract: deterministic outcomes + an
// HMAC-signed webhook endpoint. NEVER deployed outside dev/CI.
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const PORT = Number(process.env.PORT ?? 4010);
const SECRET = 'djafat-mock-webhook-secret';

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });

const server = createServer(async (req, res) => {
  if (req.url === '/health') return json(res, 200, { status: 'ok', service: 'mock-psp' });

  if (req.method === 'POST' && req.url === '/v1/payments/initiate') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const outcome = body.outcome ?? 'succeed';
    const providerRef = `mockpsp-${body.paymentId ?? Date.now()}`;
    const status = outcome === 'succeed' ? 'succeeded' : outcome === 'fail' ? 'failed' : 'pending';
    return json(res, 200, { providerRef, status });
  }

  // Build a signed webhook payload the API can verify.
  if (req.method === 'POST' && req.url === '/v1/webhooks/emit') {
    const payload = (await readBody(req)) || '{}';
    const signature = createHmac('sha256', SECRET).update(payload).digest('hex');
    return json(res, 200, { payload: JSON.parse(payload), signature, header: 'x-mock-signature' });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`mock-psp listening on :${PORT}`));
