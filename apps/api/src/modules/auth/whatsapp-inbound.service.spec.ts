import { createHmac } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../common/config/config.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import type { OtpService } from './otp.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';

// FEAT-008 — docs/features/FEAT-008-whatsapp-login (SPEC-008-02).
// Payload shape: WhatsApp Cloud API "messages" webhook. Numbers are fictitious.

const SECRET = 'test-app-secret';
const PNID = '100000000000001';
const NOW = Date.parse('2026-11-07T10:00:00Z');

interface Msg {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

function msg(over: Partial<Msg> = {}): Msg {
  return {
    from: '23566123456',
    id: 'wamid.A1',
    timestamp: String(Math.floor(NOW / 1000) - 5),
    type: 'text',
    text: { body: 'Code DJAFAT' },
    ...over,
  };
}

function body(messages: Msg[], phoneNumberId = PNID): Buffer {
  return Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '23560000001', phone_number_id: phoneNumberId },
                messages,
              },
            },
          ],
        },
      ],
    }),
  );
}

const sign = (raw: Buffer, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

function build(
  opts: { globalAllowed?: boolean; otpFails?: boolean; secret?: string | undefined } = {},
) {
  const values: Record<string, unknown> = {
    WHATSAPP_APP_SECRET: 'secret' in opts ? opts.secret : SECRET,
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    WHATSAPP_PHONE_NUMBER_ID: PNID,
    WHATSAPP_MAX_CODES_PER_HOUR: 300,
  };
  const config = { get: (k: string) => values[k] } as unknown as AppConfigService;
  const seen = new Set<string>();
  const redis = {
    client: {
      set: vi.fn(async (key: string) => {
        if (seen.has(key)) return null;
        seen.add(key);
        return 'OK';
      }),
    },
  } as unknown as RedisService;
  const rateLimiter = {
    consume: vi.fn(async () => ({
      allowed: opts.globalAllowed ?? true,
      remaining: 1,
      resetAt: new Date(NOW),
    })),
  } as unknown as RateLimiterService;
  const otp = {
    requestCode: vi.fn(async () => {
      if (opts.otpFails) {
        throw new HttpException(
          { code: 'RATE_LIMITED', message: 'x' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }),
  } as unknown as OtpService;
  return { service: new WhatsappInboundService(otp, config, redis, rateLimiter), otp };
}

describe('SPEC-008-02 — receive WhatsApp messages and answer with a code', () => {
  // SPEC-008-02-SC01
  it('SPEC-008-02-SC01 — a signed "Code DJAFAT" from a Chadian number requests a login code for +235…', async () => {
    const { service, otp } = build();
    const raw = body([msg()]);
    await service.handle(raw, sign(raw), NOW);
    expect(otp.requestCode).toHaveBeenCalledTimes(1);
    expect(otp.requestCode).toHaveBeenCalledWith(
      { channel: 'whatsapp', target: '+23566123456' },
      'login',
      null,
    );
  });

  // SPEC-008-02-SC02
  it('SPEC-008-02-SC02 — a wrong or missing signature is refused with 401 and nothing is processed', async () => {
    const { service, otp } = build();
    const raw = body([msg()]);
    await expect(service.handle(raw, sign(raw, 'other-secret'), NOW)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.handle(raw, undefined, NOW)).rejects.toMatchObject({ status: 401 });
    await expect(service.handle(raw, 'sha256=zz', NOW)).rejects.toMatchObject({ status: 401 });
    expect(otp.requestCode).not.toHaveBeenCalled();

    const unconfigured = build({ secret: undefined });
    await expect(unconfigured.service.handle(raw, sign(raw), NOW)).rejects.toMatchObject({
      status: 503,
      response: { code: 'WHATSAPP_UNAVAILABLE' },
    });
  });

  // SPEC-008-02-SC03
  it('SPEC-008-02-SC03 — the subscription handshake echoes the challenge only for the right token', () => {
    const { service } = build();
    expect(service.verifySubscription('subscribe', 'verify-me', '1158201444')).toBe('1158201444');
    expect(() => service.verifySubscription('subscribe', 'wrong', '1158201444')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
    expect(() => service.verifySubscription('unsubscribe', 'verify-me', 'x')).toThrow(
      expect.objectContaining({ status: 403 }),
    );
  });

  // SPEC-008-02-SC04
  it('SPEC-008-02-SC04 — greetings, foreign numbers, stale messages, another business number and media are ignored', async () => {
    const { service, otp } = build();
    const ignored = [
      body([msg({ id: 'w1', text: { body: 'Bonjour, je veux commander' } })]),
      body([msg({ id: 'w2', from: '2356612345' })]), // +235 with 7 digits: invalid
      body([msg({ id: 'w3', timestamp: String(Math.floor(NOW / 1000) - 11 * 60) })]),
      body([msg({ id: 'w4' })], '999999999999999'),
      body([{ from: '23566123456', id: 'w5', timestamp: msg().timestamp, type: 'image' }]),
    ];
    for (const raw of ignored) await service.handle(raw, sign(raw), NOW);
    expect(otp.requestCode).not.toHaveBeenCalled();

    // accents and case do not matter for the keyword; a valid foreign number
    // (diaspora) is accepted, as in FEAT-005 (FEAT-008-Q03)
    const raw = body([msg({ id: 'w6', text: { body: '  CÔDE djafat ' } })]);
    await service.handle(raw, sign(raw), NOW);
    const diaspora = body([msg({ id: 'w7', from: '33612345678' })]);
    await service.handle(diaspora, sign(diaspora), NOW);
    expect(otp.requestCode).toHaveBeenCalledTimes(2);
    expect(otp.requestCode).toHaveBeenLastCalledWith(
      { channel: 'whatsapp', target: '+33612345678' },
      'login',
      null,
    );
  });

  // SPEC-008-02-SC05
  it('SPEC-008-02-SC05 — the same message delivered twice yields one code', async () => {
    const { service, otp } = build();
    const raw = body([msg({ id: 'wamid.DUP' })]);
    await service.handle(raw, sign(raw), NOW);
    await service.handle(raw, sign(raw), NOW);
    expect(otp.requestCode).toHaveBeenCalledTimes(1);
  });

  // SPEC-008-02-SC06
  it('SPEC-008-02-SC06 — hourly cap reached or per-number refusal: nothing sent, handled without error', async () => {
    const capped = build({ globalAllowed: false });
    const raw = body([msg()]);
    await expect(capped.service.handle(raw, sign(raw), NOW)).resolves.toBeDefined();
    expect(capped.otp.requestCode).not.toHaveBeenCalled();

    const refused = build({ otpFails: true });
    const raw2 = body([msg({ id: 'r1' }), msg({ id: 'r2', from: '23599887766' })]);
    await expect(refused.service.handle(raw2, sign(raw2), NOW)).resolves.toBeDefined();
    expect(refused.otp.requestCode).toHaveBeenCalledTimes(2); // one failure does not stop the next
  });
});
