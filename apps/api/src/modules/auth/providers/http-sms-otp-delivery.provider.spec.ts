import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger, type ArgumentsHost } from '@nestjs/common';
import type { ApiErrorBody } from '@djafat/types';
import { AllExceptionsFilter } from '../../../common/errors/all-exceptions.filter';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../../common/config/config.service';
import { HttpSmsOtpDeliveryProvider } from './http-sms-otp-delivery.provider';
import { otpSmsText } from './otp-sms-text';

// FEAT-006 — docs/features/FEAT-006-real-sms-otp-delivery (SPEC-006-01).
// The adapter is exercised against a REAL local HTTP server: no fetch mock.

interface Received {
  readonly method: string | undefined;
  readonly auth: string | undefined;
  readonly body: unknown;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  vi.restoreAllMocks();
});

async function gateway(statuses: number[]): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      received.push({
        method: req.method,
        auth: req.headers.authorization,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      });
      res.writeHead(statuses.shift() ?? 202, { 'content-type': 'application/json' });
      res.end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/send`, received };
}

function provider(values: Record<string, string | undefined>): HttpSmsOtpDeliveryProvider {
  const config = { get: (k: string) => values[k] } as unknown as AppConfigService;
  return new HttpSmsOtpDeliveryProvider(config);
}

const FICTIVE_AIRTEL = '+23566000099'; // fictitious number, never a real subscriber

describe('SPEC-006-01 — OTP delivery through an HTTP SMS gateway', () => {
  // SPEC-006-01-SC01
  it('SPEC-006-01-SC01 — posts { to, from, body } with the bearer key to the configured gateway', async () => {
    const gw = await gateway([202]);
    await provider({
      SMS_HTTP_URL: gw.url,
      SMS_HTTP_API_KEY: 'k-123',
      SMS_SENDER_ID: 'DJAFAT',
    }).send({
      to: FICTIVE_AIRTEL,
      code: '482913',
      ttlSeconds: 300,
      locale: 'fr',
    });
    expect(gw.received).toHaveLength(1);
    expect(gw.received[0]).toMatchObject({ method: 'POST', auth: 'Bearer k-123' });
    expect(gw.received[0]?.body).toMatchObject({ to: FICTIVE_AIRTEL, from: 'DJAFAT' });
    expect((gw.received[0]?.body as { body: string }).body).toContain('482913');
  });

  // SPEC-006-01-SC02
  it('SPEC-006-01-SC02 — the SMS text is the exact ASCII single-segment message', () => {
    const text = otpSmsText('482913', 300);
    expect(text).toBe(
      'DJAFAT : votre code est 482913. Valable 5 min. Ne le communiquez a personne.',
    );
    expect(otpSmsText('482913', 90)).toContain('Valable 2 min');
    expect(/^[\x20-\x7e]+$/.test(text)).toBe(true);
    expect(text.length).toBeLessThan(160);
  });

  // SPEC-006-01-SC03
  it('SPEC-006-01-SC03 — a transient server error is retried once', async () => {
    const gw = await gateway([503, 202]);
    await provider({ SMS_HTTP_URL: gw.url }).send({
      to: FICTIVE_AIRTEL,
      code: '111111',
      ttlSeconds: 300,
      locale: 'fr',
    });
    expect(gw.received).toHaveLength(2);
  });

  // SPEC-006-01-SC04
  it('SPEC-006-01-SC04 — persistent failure or unreachable gateway: 503 OTP_DELIVERY_FAILED after 2 attempts', async () => {
    const gw = await gateway([500, 500, 500]);
    const failure = { status: 503, response: { code: 'OTP_DELIVERY_FAILED' } };
    await expect(
      provider({ SMS_HTTP_URL: gw.url }).send({
        to: FICTIVE_AIRTEL,
        code: '111111',
        ttlSeconds: 300,
        locale: 'fr',
      }),
    ).rejects.toMatchObject(failure);
    expect(gw.received).toHaveLength(2);

    await expect(
      provider({ SMS_HTTP_URL: 'http://127.0.0.1:1/send' }).send({
        to: FICTIVE_AIRTEL,
        code: '111111',
        ttlSeconds: 300,
        locale: 'fr',
      }),
    ).rejects.toMatchObject(failure);
  });

  // SPEC-006-01-SC04 — regression found by the end-to-end run: the client must
  // see OTP_DELIVERY_FAILED after the REAL error filter, not just on the raw exception.
  it('SPEC-006-01-SC04 — the failure reaches the client as 503 OTP_DELIVERY_FAILED through AllExceptionsFilter', async () => {
    const err = await provider({ SMS_HTTP_URL: 'http://127.0.0.1:1/send' })
      .send({ to: FICTIVE_AIRTEL, code: '111111', ttlSeconds: 300, locale: 'fr' })
      .catch((e: unknown) => e);
    let status = 0;
    let body: ApiErrorBody | undefined;
    const res = {
      status: (c: number) => {
        status = c;
        return res;
      },
      send: (b: ApiErrorBody) => {
        body = b;
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ id: 't', headers: {} }),
      }),
    } as unknown as ArgumentsHost;
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    new AllExceptionsFilter().catch(err, host);
    expect(status).toBe(503);
    expect(body?.error.code).toBe('OTP_DELIVERY_FAILED');
  });

  // SPEC-006-01-SC05
  it('SPEC-006-01-SC05 — a client error (4xx) is not retried', async () => {
    const gw = await gateway([400, 202]);
    await expect(
      provider({ SMS_HTTP_URL: gw.url }).send({
        to: FICTIVE_AIRTEL,
        code: '111111',
        ttlSeconds: 300,
        locale: 'fr',
      }),
    ).rejects.toMatchObject({ status: 503, response: { code: 'OTP_DELIVERY_FAILED' } });
    expect(gw.received).toHaveLength(1);
  });

  // SPEC-006-01-SC06
  it('SPEC-006-01-SC06 — never logs the code, the key or the full number', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const ok = await gateway([202]);
    await provider({ SMS_HTTP_URL: ok.url, SMS_HTTP_API_KEY: 'k-secret' }).send({
      to: FICTIVE_AIRTEL,
      code: '735246',
      ttlSeconds: 300,
      locale: 'fr',
    });
    const ko = await gateway([500, 500]);
    await provider({ SMS_HTTP_URL: ko.url, SMS_HTTP_API_KEY: 'k-secret' })
      .send({ to: FICTIVE_AIRTEL, code: '735246', ttlSeconds: 300, locale: 'fr' })
      .catch(() => undefined);
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    expect(all).not.toContain('735246');
    expect(all).not.toContain('k-secret');
    expect(all).not.toContain(FICTIVE_AIRTEL);
  });
});
