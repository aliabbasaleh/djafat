import { Logger, type ArgumentsHost } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiErrorBody, OtpDeliveryPurpose } from '@djafat/types';
import type { RedisService } from '../../../common/redis/redis.service';
import { AllExceptionsFilter } from '../../../common/errors/all-exceptions.filter';
import { SmtpEmailOtpDeliveryProvider } from './smtp-email-otp-delivery.provider';
import { MockEmailOtpDeliveryProvider } from './mock-email-otp-delivery.provider';
import { emailOtpMessage } from './email-otp-text';
import { closeSmtpSinks, configFake as config, decodedBody, smtpSink } from './smtp-test-support';

// FEAT-007 — docs/features/FEAT-007-email-login (SPEC-007-01). The SMTP
// adapter talks to a REAL local SMTP server (smtp-server), not a mock.
// FEAT-020 — SPEC-020-01: a wording per purpose, the Gmail settings.

afterEach(async () => {
  await closeSmtpSinks();
  vi.restoreAllMocks();
});

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

describe('SPEC-020-01 — one wording per purpose', () => {
  const purposes: OtpDeliveryPurpose[] = [
    'register',
    'login',
    'login_device',
    'reset_password',
    'verify_email',
  ];

  // SPEC-020-01-SC04
  it('SPEC-020-01-SC04 — each purpose has its own subject; the text has the code and the validity', () => {
    const subjects = purposes.map((purpose) => {
      const message = emailOtpMessage('123456', 300, purpose);
      expect(message.text, purpose).toContain('123456');
      expect(message.text, purpose).toContain('5 min');
      return message.subject;
    });
    expect(new Set(subjects).size).toBe(purposes.length);
    // Without a purpose: the FEAT-007 login code, unchanged.
    expect(emailOtpMessage('123456', 300)).toEqual(emailOtpMessage('123456', 300, 'login'));
  });

  // SPEC-020-01-SC04
  it('SPEC-020-01-SC04 — over SMTP, Gmail-style settings, the registration wording and nothing in the logs', async () => {
    const logs: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    }
    const sink = await smtpSink();
    await new SmtpEmailOtpDeliveryProvider(
      config({
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: sink.port,
        SMTP_USER: 'djafat@example.td',
        SMTP_PASSWORD: 'app-password-xyz',
      }),
    ).send({
      to: 'awa@example.td',
      code: '123456',
      ttlSeconds: 300,
      locale: 'fr',
      purpose: 'register',
    });

    expect(sink.received).toHaveLength(1);
    expect(sink.received[0]).toMatchObject({ from: 'djafat@example.td', to: ['awa@example.td'] });
    const body = decodedBody(sink.received[0]?.raw ?? '');
    expect(body).toContain('Pour créer votre compte DJAFAT, saisissez ce code : 123456');
    expect(body).toContain('5 min');

    const all = logs.join('\n');
    expect(all).not.toContain('123456');
    expect(all).not.toContain('awa@example.td');
    expect(all).not.toContain('app-password-xyz');
  });
});
