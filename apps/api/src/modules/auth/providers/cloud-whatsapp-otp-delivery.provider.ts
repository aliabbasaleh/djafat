import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
import { AppConfigService } from '../../../common/config/config.service';
import { whatsappOtpText } from './whatsapp-otp-text';

const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 2; // one retry on network error / timeout / 5xx (SPEC-008-04 R2)

/**
 * Replies with the login code through Meta's WhatsApp Cloud API (FEAT-008).
 * Always a reply to a message the customer just sent (SPEC-008-02), i.e. a
 * free-form "service" message inside the 24 h window — no paid template.
 *
 * Never logs the code, the token, the response body or the full number.
 */
@Injectable()
export class CloudWhatsappOtpDeliveryProvider implements OtpDeliveryPort {
  readonly channel = 'whatsapp' as const;
  private readonly logger = new Logger(CloudWhatsappOtpDeliveryProvider.name);

  constructor(private readonly config: AppConfigService) {}

  async send(input: {
    to: string;
    code: string;
    ttlSeconds: number;
    locale: string;
  }): Promise<void> {
    const base = this.config.get('WHATSAPP_GRAPH_URL');
    const phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID');
    const token = this.config.get('WHATSAPP_ACCESS_TOKEN');
    if (!phoneNumberId || !token) throw this.failure('WhatsApp Cloud not configured');
    const url = `${base.replace(/\/$/, '')}/${phoneNumberId}/messages`;
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to: input.to.replace(/^\+/, ''),
      type: 'text',
      text: { body: whatsappOtpText(input.code, input.ttlSeconds) },
    });
    const to = redactPhone(input.to);

    let lastReason = 'unknown';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: payload,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        await res.body?.cancel();
        if (res.ok) {
          this.logger.log(`OTP WhatsApp reply accepted for ${to} (attempt ${attempt})`);
          return;
        }
        lastReason = `Graph API answered ${res.status}`;
        if (res.status < 500) break; // a client error will not fix itself
      } catch (err) {
        lastReason =
          err instanceof Error && err.name === 'TimeoutError'
            ? 'Graph API timeout'
            : 'Graph API unreachable';
      }
      this.logger.warn(
        `OTP WhatsApp attempt ${attempt}/${MAX_ATTEMPTS} for ${to} failed: ${lastReason}`,
      );
    }
    throw this.failure(lastReason);
  }

  private failure(reason: string): HttpException {
    this.logger.error(`OTP WhatsApp delivery failed: ${reason}`);
    return new HttpException(
      {
        code: 'OTP_DELIVERY_FAILED',
        message: "Impossible d'envoyer le code sur WhatsApp, réessayez dans un instant.",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

function redactPhone(phone: string): string {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
}
