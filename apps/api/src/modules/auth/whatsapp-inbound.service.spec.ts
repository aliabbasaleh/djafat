import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfigService } from '../../common/config/config.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { WhatsappCodeService, WhatsappReceipt } from './whatsapp-code.service';
import { WhatsappInboundService } from './whatsapp-inbound.service';
import { readWhatsappCode } from './whatsapp-message';

// FEAT-008 (SPEC-008-02: signature, subscription) and FEAT-023 (SPEC-023-02:
// a message carrying a code). Payload shape: WhatsApp Cloud API "messages"
// webhook. Numbers are fictitious.

const SECRET = 'test-app-secret';
const PNID = '100000000000001';
const NOW = Date.parse('2026-11-25T10:00:00Z');
const LOGIN =
  "Je me connecte à DJAFAT : 482915 (n'envoyez ce code que pour vous connecter vous-même)";

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
    text: { body: LOGIN },
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
                metadata: { display_phone_number: '23566868973', phone_number_id: phoneNumberId },
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
  opts: { secret?: string | undefined; receipt?: WhatsappReceipt; receiveFails?: boolean } = {},
) {
  const values: Record<string, unknown> = {
    WHATSAPP_APP_SECRET: 'secret' in opts ? opts.secret : SECRET,
    WHATSAPP_VERIFY_TOKEN: 'verify-me',
    WHATSAPP_PHONE_NUMBER_ID: PNID,
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
      del: vi.fn(async (key: string) => (seen.delete(key) ? 1 : 0)),
    },
  } as unknown as RedisService;
  const codes = {
    receive: vi.fn(async () => {
      if (opts.receiveFails) throw new Error('database down');
      return opts.receipt ?? 'matched';
    }),
  };
  const service = new WhatsappInboundService(
    codes as unknown as WhatsappCodeService,
    config,
    redis,
  );
  return { service, codes, redis };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SPEC-008-02 — the signed webhook (unchanged by FEAT-023)', () => {
  // SPEC-008-02-SC02
  it('SPEC-008-02-SC02 — a wrong or missing signature is refused with 401 and nothing is processed', async () => {
    const { service, codes } = build();
    const raw = body([msg()]);
    await expect(service.handle(raw, sign(raw, 'other-secret'), NOW)).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.handle(raw, undefined, NOW)).rejects.toMatchObject({ status: 401 });
    await expect(service.handle(raw, 'sha256=zz', NOW)).rejects.toMatchObject({ status: 401 });
    expect(codes.receive).not.toHaveBeenCalled();

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
});

describe('SPEC-023-02 — a message carrying a code', () => {
  // SPEC-023-02-SC01
  it('SPEC-023-02-SC01 — a signed code message is handed over with its sender; nothing is sent back', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { service, codes } = build();
    const raw = body([msg()]);
    await expect(service.handle(raw, sign(raw), NOW)).resolves.toEqual({ codesReceived: 1 });
    expect(codes.receive).toHaveBeenCalledWith({ from: '+23566123456', code: '482915' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // SPEC-023-02-SC05
  it('SPEC-023-02-SC05 — the same message delivered twice by Meta is handed over once', async () => {
    const { service, codes } = build();
    const raw = body([msg({ id: 'wamid.DUP' })]);
    await service.handle(raw, sign(raw), NOW);
    await service.handle(raw, sign(raw), NOW);
    expect(codes.receive).toHaveBeenCalledTimes(1);
  });

  // SPEC-023-02-SC06, SPEC-023-08-SC01 (« Code DJAFAT » gets nothing)
  it('SPEC-023-02-SC06 — « Code DJAFAT », no « DJAFAT », two codes, a bad number, a stale message, a photo, another business number: ignored', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { service, codes } = build();
    const ignored = [
      body([msg({ id: 'w1', text: { body: 'Code DJAFAT' } })]),
      body([msg({ id: 'w2', text: { body: 'Bonjour, mon code est 482915' } })]),
      body([msg({ id: 'w3', text: { body: 'DJAFAT 482915 ou 731022 ?' } })]),
      body([msg({ id: 'w4', from: '2356612345' })]), // +235 with 7 digits: invalid
      body([msg({ id: 'w5', timestamp: String(Math.floor(NOW / 1000) - 11 * 60) })]),
      body([{ from: '23566123456', id: 'w6', timestamp: msg().timestamp, type: 'image' }]),
      body([msg({ id: 'w7' })], '999999999999999'),
    ];
    for (const raw of ignored) {
      await expect(service.handle(raw, sign(raw), NOW)).resolves.toEqual({ codesReceived: 0 });
    }
    expect(codes.receive).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('SPEC-023-02 R3 — the code is read whatever the case and accents, even edited, never inside a longer number', () => {
    expect(readWhatsappCode(LOGIN)).toBe('482915');
    expect(readWhatsappCode('djafàt 482915')).toBe('482915');
    expect(readWhatsappCode('DJAFAT : 482915, 482915')).toBe('482915'); // pasted twice: one code
    expect(readWhatsappCode('DJAFAT 66482915')).toBeNull(); // eight digits: a phone number
    expect(readWhatsappCode('DJAFAT 48 29 15')).toBeNull();
    expect(readWhatsappCode('Code DJAFAT')).toBeNull();
  });

  // SPEC-023-02 « Erreurs et cas limites »: not processed → Meta redelivers.
  it('SPEC-023-02 « Erreurs » — a failure half-way answers 500 and lets Meta’s redelivery through', async () => {
    const failing = build({ receiveFails: true });
    const raw = body([msg({ id: 'wamid.RETRY' })]);
    await expect(failing.service.handle(raw, sign(raw), NOW)).rejects.toThrow('database down');
    expect(failing.redis.client.del).toHaveBeenCalledWith('wa:msg:wamid.RETRY');
    await expect(failing.service.handle(raw, sign(raw), NOW)).rejects.toThrow('database down');
    expect(failing.codes.receive).toHaveBeenCalledTimes(2);
  });

  it('a code nobody waits for or a locked sender: handled without error, counted as not received', async () => {
    for (const receipt of ['no_code', 'locked'] as const) {
      const { service } = build({ receipt });
      const raw = body([msg({ id: `w-${receipt}` })]);
      await expect(service.handle(raw, sign(raw), NOW)).resolves.toEqual({ codesReceived: 0 });
    }
  });
});
