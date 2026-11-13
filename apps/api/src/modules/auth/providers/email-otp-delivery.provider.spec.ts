import type { AddressInfo } from 'node:net';
import { Logger, type ArgumentsHost } from '@nestjs/common';
import { SMTPServer } from 'smtp-server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorBody } from '@djafat/types';
import type { AppConfigService } from '../../../common/config/config.service';
import type { RedisService } from '../../../common/redis/redis.service';
import { AllExceptionsFilter } from '../../../common/errors/all-exceptions.filter';
import { SmtpEmailOtpDeliveryProvider } from './smtp-email-otp-delivery.provider';
import { MockEmailOtpDeliveryProvider } from './mock-email-otp-delivery.provider';
import { emailOtpMessage } from './email-otp-text';

// FEAT-007 — docs/features/FEAT-007-email-login (SPEC-007-01). The SMTP
// adapter talks to a REAL local SMTP server (smtp-server), not a mock.

interface Received {
  readonly from: string | undefined;
  readonly to: string[];
  readonly raw: string;
}

const servers: SMTPServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
  vi.restoreAllMocks();
});

async function smtpSink(): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = new SMTPServer({
    authOptional: true,
    allowInsecureAuth: true, // local test sink only: accept AUTH without TLS
    onAuth(_auth, _session, callback) {
      callback(null, { user: 'mailer' });
    },
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, session, callback) {
      let raw = '';
      stream.on('data', (c: Buffer) => (raw += c.toString()));
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom ? session.envelope.mailFrom.address : undefined,
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
        });
        callback();
      });
    },
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { url: `smtp://127.0.0.1:${(server.server.address() as AddressInfo).port}`, received };
}

function config(values: Record<string, unknown>): AppConfigService {
  return {
    get: (k: string) => values[k],
    isProduction: values['NODE_ENV'] === 'production',
  } as unknown as AppConfigService;
}

function throughFilter(err: unknown): { status: number; body: ApiErrorBody | undefined } {
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
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ id: 't', headers: {} }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(err, host);
  return { status, body };
}

const FROM = 'DJAFAT <no-reply@djafat.test>';

describe('SPEC-007-01 — email OTP delivery', () => {
  // SPEC-007-01-SC01
  it('SPEC-007-01-SC01 — sends a real SMTP message with the code and validity', async () => {
    const sink = await smtpSink();
    await new SmtpEmailOtpDeliveryProvider(config({ SMTP_URL: sink.url, EMAIL_FROM: FROM })).send({
      to: 'awa@example.td',
      code: '482913',
      ttlSeconds: 600,
      locale: 'fr',
    });
    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]).toMatchObject({
      from: 'no-reply@djafat.test',
      to: ['awa@example.td'],
    });
    const raw = sink.received[0]?.raw ?? '';
    expect(raw).toContain('Subject: Votre code de connexion DJAFAT');
    expect(raw).toContain('482913');
    expect(raw).toContain('10 min');
    const message = emailOtpMessage('482913', 600);
    expect(message.subject).toBe('Votre code de connexion DJAFAT');
    expect(message.text).toMatch(/ne le communiquez/i);
  });

  // SPEC-007-01-SC02
  it('SPEC-007-01-SC02 — an unreachable SMTP server surfaces as 503 OTP_DELIVERY_FAILED', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const err = await new SmtpEmailOtpDeliveryProvider(
      config({ SMTP_URL: 'smtp://127.0.0.1:1', EMAIL_FROM: FROM }),
    )
      .send({ to: 'awa@example.td', code: '111111', ttlSeconds: 600, locale: 'fr' })
      .catch((e: unknown) => e);
    expect(throughFilter(err)).toMatchObject({
      status: 503,
      body: { error: { code: 'OTP_DELIVERY_FAILED' } },
    });
  });

  // SPEC-007-01-SC03
  it('SPEC-007-01-SC03 — the mock in production: 503 EMAIL_UNAVAILABLE and nothing stored', async () => {
    const set = vi.fn();
    const redis = { client: { set } } as unknown as RedisService;
    const err = await new MockEmailOtpDeliveryProvider(redis, config({ NODE_ENV: 'production' }))
      .send({ to: 'awa@example.td', code: '111111', ttlSeconds: 600, locale: 'fr' })
      .catch((e: unknown) => e);
    expect(throughFilter(err)).toMatchObject({
      status: 503,
      body: { error: { code: 'EMAIL_UNAVAILABLE' } },
    });
    expect(set).not.toHaveBeenCalled();

    await new MockEmailOtpDeliveryProvider(redis, config({ NODE_ENV: 'development' })).send({
      to: 'awa@example.td',
      code: '222222',
      ttlSeconds: 600,
      locale: 'fr',
    });
    expect(set).toHaveBeenCalledWith('otp:mock:email:awa@example.td', '222222', 'EX', 600);
  });

  // SPEC-007-01-SC05
  it('SPEC-007-01-SC05 — never logs the code, the full address or the SMTP password', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const sink = await smtpSink();
    const ok = sink.url.replace('smtp://', 'smtp://mailer:s3cr3t-pass@');
    await new SmtpEmailOtpDeliveryProvider(config({ SMTP_URL: ok, EMAIL_FROM: FROM })).send({
      to: 'awa@example.td',
      code: '735246',
      ttlSeconds: 600,
      locale: 'fr',
    });
    await new SmtpEmailOtpDeliveryProvider(
      config({ SMTP_URL: 'smtp://mailer:s3cr3t-pass@127.0.0.1:1', EMAIL_FROM: FROM }),
    )
      .send({ to: 'awa@example.td', code: '735246', ttlSeconds: 600, locale: 'fr' })
      .catch(() => undefined);
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    expect(all).not.toContain('735246');
    expect(all).not.toContain('awa@example.td');
    expect(all).not.toContain('s3cr3t-pass');
  });
});
