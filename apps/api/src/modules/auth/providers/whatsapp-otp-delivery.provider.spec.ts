import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../../common/config/config.service';
import type { RedisService } from '../../../common/redis/redis.service';
import { CloudWhatsappOtpDeliveryProvider } from './cloud-whatsapp-otp-delivery.provider';
import {
  MockWhatsappOtpDeliveryProvider,
  mockWhatsappOtpKey,
} from './mock-whatsapp-otp-delivery.provider';

// FEAT-008 — docs/features/FEAT-008-whatsapp-login (SPEC-008-04).
// The adapter is exercised against a REAL local HTTP server standing in for the Graph API.

const PHONE = '+23566123456'; // fictitious
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  vi.restoreAllMocks();
});

interface Received {
  readonly url: string | undefined;
  readonly auth: string | undefined;
  readonly body: {
    to?: string;
    type?: string;
    messaging_product?: string;
    text?: { body: string };
  };
}

async function graph(statuses: number[]): Promise<{ base: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      received.push({
        url: req.url,
        auth: req.headers.authorization,
        body: raw ? (JSON.parse(raw) as Received['body']) : {},
      });
      res.writeHead(statuses.shift() ?? 200, { 'content-type': 'application/json' });
      res.end('{"messages":[{"id":"wamid.X"}]}');
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v21.0`, received };
}

function cloud(base: string) {
  const values: Record<string, string> = {
    WHATSAPP_GRAPH_URL: base,
    WHATSAPP_PHONE_NUMBER_ID: 'PNID',
    WHATSAPP_ACCESS_TOKEN: 'tok-secret',
  };
  return new CloudWhatsappOtpDeliveryProvider({
    get: (k: string) => values[k],
  } as unknown as AppConfigService);
}

const send = (p: { send: CloudWhatsappOtpDeliveryProvider['send'] }, code = '482913') =>
  p.send({ to: PHONE, code, ttlSeconds: 300, locale: 'fr' });

describe('SPEC-008-04 — send the code through the WhatsApp Cloud API', () => {
  // SPEC-008-04-SC01
  it('SPEC-008-04-SC01 — posts an authenticated text message to /<phone_number_id>/messages', async () => {
    const g = await graph([200]);
    await send(cloud(g.base));
    expect(g.received).toHaveLength(1);
    expect(g.received[0]).toMatchObject({ url: '/v21.0/PNID/messages', auth: 'Bearer tok-secret' });
    expect(g.received[0]?.body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '23566123456',
      type: 'text',
    });
    const text = g.received[0]?.body.text?.body ?? '';
    expect(text).toContain('482913');
    expect(text).toContain('5 min');
    expect(text).toContain('Ne le donnez à personne');
  });

  // SPEC-008-04-SC02
  it('SPEC-008-04-SC02 — a 5xx is retried exactly once', async () => {
    const g = await graph([500, 200]);
    await send(cloud(g.base));
    expect(g.received).toHaveLength(2);
  });

  // SPEC-008-04-SC03
  it('SPEC-008-04-SC03 — a 4xx is not retried, fails with 503 OTP_DELIVERY_FAILED, and logs nothing secret', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const g = await graph([401, 200]);
    await expect(send(cloud(g.base), '735246')).rejects.toMatchObject({
      status: 503,
      response: { code: 'OTP_DELIVERY_FAILED' },
    });
    expect(g.received).toHaveLength(1);
    const all = logs.join('\n');
    expect(logs.length).toBeGreaterThan(0);
    expect(all).not.toContain('735246');
    expect(all).not.toContain('tok-secret');
    expect(all).not.toContain('66123456');
  });

  // SPEC-008-04-SC04
  it('SPEC-008-04-SC04 — the mock stores the code in Redis outside production and is unavailable in production', async () => {
    const store = new Map<string, string>();
    const redis = {
      client: {
        set: vi.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    } as unknown as RedisService;
    const dev = new MockWhatsappOtpDeliveryProvider(redis, {
      isProduction: false,
    } as unknown as AppConfigService);
    await send(dev, '246810');
    expect(store.get(mockWhatsappOtpKey(PHONE))).toBe('246810');
    expect(redis.client.set).toHaveBeenCalledWith(mockWhatsappOtpKey(PHONE), '246810', 'EX', 300);

    const prod = new MockWhatsappOtpDeliveryProvider(redis, {
      isProduction: true,
    } as unknown as AppConfigService);
    await expect(send(prod)).rejects.toMatchObject({
      status: 503,
      response: { code: 'WHATSAPP_UNAVAILABLE' },
    });
  });
});
