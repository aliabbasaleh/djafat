// Minimal, dependency-free mock SMS gateway for local dev / CI.
// Stores the last messages in memory so tests can read the OTP code back.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 4020);
const sent = [];

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => resolve(d));
  });

const server = createServer(async (req, res) => {
  if (req.url === '/health') return json(res, 200, { status: 'ok', service: 'mock-sms' });

  if (req.method === 'POST' && req.url === '/send') {
    const { to, body } = JSON.parse((await readBody(req)) || '{}');
    const message = { id: `sms-${sent.length + 1}`, to, body, at: new Date().toISOString() };
    sent.unshift(message);
    return json(res, 202, { accepted: true, id: message.id });
  }

  if (req.method === 'GET' && req.url?.startsWith('/messages')) {
    return json(res, 200, { messages: sent.slice(0, 50) });
  }

  json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => console.log(`mock-sms listening on :${PORT}`));
