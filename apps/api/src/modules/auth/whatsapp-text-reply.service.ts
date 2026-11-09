import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../common/config/config.service';
import { RedisService } from '../../common/redis/redis.service';

const TIMEOUT_MS = 5_000;
const MOCK_TTL_SECONDS = 60 * 60;

/**
 * A free-text WhatsApp reply to a customer who just wrote to DJAFAT's number
 * (FEAT-017: the answer to an order sent by message). Inside the 24 h window
 * opened by the customer, so a free "service" message, no paid template.
 *
 * `WHATSAPP_PROVIDER=cloud` → Meta Graph API; `mock` → kept in Redis for dev
 * and tests (`mockWhatsappReplyKey`), never sent. Best effort: a reply that
 * cannot be sent is logged (without the text or the full number), never
 * thrown, so the order itself is never undone by a messaging failure.
 */
@Injectable()
export class WhatsappTextReplyService {
  private readonly logger = new Logger(WhatsappTextReplyService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  async send(to: string, text: string): Promise<boolean> {
    try {
      if (this.config.get('WHATSAPP_PROVIDER') !== 'cloud') {
        if (this.config.isProduction) return false;
        const key = mockWhatsappReplyKey(to);
        await this.redis.client.rpush(key, text);
        await this.redis.client.expire(key, MOCK_TTL_SECONDS);
        return true;
      }
      const base = this.config.get('WHATSAPP_GRAPH_URL');
      const phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID');
      const token = this.config.get('WHATSAPP_ACCESS_TOKEN');
      if (!phoneNumberId || !token) return false;
      const res = await fetch(`${base.replace(/\/$/, '')}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/^\+/, ''),
          type: 'text',
          text: { body: text },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (!res.ok) this.logger.warn(`WhatsApp reply to ${redact(to)}: Graph API ${res.status}`);
      return res.ok;
    } catch (err) {
      this.logger.warn(
        `WhatsApp reply to ${redact(to)} not sent: ${err instanceof Error ? err.name : 'error'}`,
      );
      return false;
    }
  }
}

export function mockWhatsappReplyKey(phone: string): string {
  return `wa:mock:reply:${phone}`;
}

function redact(phone: string): string {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
}
