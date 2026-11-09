import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LAUNCH_MARKET } from '@djafat/config';
import { makePhoneInputSchema } from '@djafat/validation';
import { AppConfigService } from '../../common/config/config.service';
import { RedisService } from '../../common/redis/redis.service';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { OtpService } from './otp.service';

const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000; // FEAT-008-Q07
const DEDUP_TTL_SECONDS = 24 * 60 * 60; // FEAT-008-Q06
const PhoneInput = makePhoneInputSchema(LAUNCH_MARKET);

/** The slice of the WhatsApp Cloud "messages" webhook this service reads. */
interface InboundMessage {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
}

interface InboundPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: { metadata?: { phone_number_id?: string }; messages?: InboundMessage[] };
    }>;
  }>;
}

/**
 * Receives the messages customers send to DJAFAT's WhatsApp number and
 * replies with a login code (FEAT-008, SPEC-008-02). The customer writes
 * first, so the reply is a free service message. A message alone never logs
 * anyone in (FEAT-008-Q01): only the reply's code does, and only the owner
 * of the number sees it.
 */
@Injectable()
export class WhatsappInboundService {
  private readonly logger = new Logger(WhatsappInboundService.name);

  constructor(
    private readonly otp: OtpService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
    private readonly rateLimiter: RateLimiterService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  /** Meta's subscription handshake: echo the challenge for the right token only. */
  verifySubscription(
    mode: string | undefined,
    token: string | undefined,
    challenge: string | undefined,
  ): string {
    const expected = this.config.get('WHATSAPP_VERIFY_TOKEN');
    if (mode !== 'subscribe' || !expected || !token || !safeEqual(token, expected) || !challenge) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Invalid verification request.' });
    }
    return challenge;
  }

  /** Verifies the signature, then handles each message independently. */
  async handle(
    rawBody: Buffer,
    signature: string | undefined,
    now: number = Date.now(),
  ): Promise<{ codesRequested: number }> {
    this.assertSigned(rawBody, signature);
    let payload: InboundPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as InboundPayload;
    } catch {
      return { codesRequested: 0 }; // signed but unreadable: nothing to do, no retry loop
    }

    const ourNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID');
    let codesRequested = 0;
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        if (!value || value.metadata?.phone_number_id !== ourNumberId) continue;
        for (const message of value.messages ?? []) {
          if (await this.handleMessage(message, now)) codesRequested += 1;
        }
      }
    }
    return { codesRequested };
  }

  private async handleMessage(message: InboundMessage, now: number): Promise<boolean> {
    if (message.type !== 'text' || !message.id || !message.from) return false;
    const text = message.text?.body ?? '';
    // FEAT-017: an order written by the app when the data connection failed.
    if (isOrderMessage(text)) {
      await this.handleOrderMessage(message, text, now);
      return false;
    }
    if (!asksForCode(text)) return false; // FEAT-008-Q02
    const sentAt = Number(message.timestamp) * 1000;
    if (!Number.isFinite(sentAt) || now - sentAt > MAX_MESSAGE_AGE_MS) return false;
    const phone = PhoneInput.safeParse(`+${message.from}`); // FEAT-008-Q03: same rule as FEAT-005
    if (!phone.success) return false;
    if (!(await this.firstDelivery(message.id))) return false;

    const cap = await this.rateLimiter.consume(
      'otp:whatsapp:global',
      this.config.get('WHATSAPP_MAX_CODES_PER_HOUR'),
      3600,
    );
    if (!cap.allowed) {
      this.logger.warn('WhatsApp login codes: hourly cap reached, message not answered');
      return false;
    }
    try {
      await this.otp.requestCode({ channel: 'whatsapp', target: phone.data }, 'login', null);
      return true;
    } catch (err) {
      const status = err instanceof HttpException ? err.getStatus() : 500;
      this.logger.warn(`WhatsApp login code not sent (${status}) for ${redactPhone(phone.data)}`);
      return false;
    }
  }

  /**
   * Handed to whoever places offline orders (`admin`, which may compose the
   * other modules) by event — `auth` never imports `orders`. Same freshness,
   * phone and once-only rules as a login code request.
   */
  private async handleOrderMessage(
    message: InboundMessage,
    text: string,
    now: number,
  ): Promise<void> {
    const sentAt = Number(message.timestamp) * 1000;
    if (!Number.isFinite(sentAt) || now - sentAt > MAX_MESSAGE_AGE_MS) return;
    const phone = PhoneInput.safeParse(`+${message.from}`);
    if (!phone.success || !this.events) return;
    if (!(await this.firstDelivery(message.id!))) return;
    try {
      await this.events.emitAsync('order_message.received', {
        phone: phone.data,
        text,
        channel: 'whatsapp',
      } satisfies OrderMessageReceived);
    } catch (err) {
      this.logger.error(
        `offline order from ${redactPhone(phone.data)} failed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  }

  private assertSigned(rawBody: Buffer, signature: string | undefined): void {
    const secret = this.config.get('WHATSAPP_APP_SECRET');
    if (!secret) {
      throw new HttpException(
        { code: 'WHATSAPP_UNAVAILABLE', message: 'WhatsApp is not configured.' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
    if (!signature || !safeEqual(signature, expected)) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Invalid signature.' });
    }
  }

  /** Best effort: if Redis is down, a duplicate only yields a second code under the same limits. */
  private async firstDelivery(messageId: string): Promise<boolean> {
    try {
      const r = await this.redis.client.set(
        `wa:msg:${messageId}`,
        '1',
        'EX',
        DEDUP_TTL_SECONDS,
        'NX',
      );
      return r === 'OK';
    } catch {
      return true;
    }
  }
}

/** FEAT-017 — the payload of `order_message.received`. */
export interface OrderMessageReceived {
  readonly phone: string;
  readonly text: string;
  readonly channel: 'whatsapp';
}

function isOrderMessage(text: string): boolean {
  return /^\s*djf1\s/i.test(text);
}

/** "code" anywhere, ignoring case and accents ("Code DJAFAT", "côde"). */
function asksForCode(text: string): boolean {
  return /\bcode\b/.test(
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase(),
  );
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function redactPhone(phone: string): string {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
}
