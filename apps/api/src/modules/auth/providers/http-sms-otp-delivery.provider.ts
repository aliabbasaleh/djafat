import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
import { AppConfigService } from '../../../common/config/config.service';
import { otpSmsText } from './otp-sms-text';

const TIMEOUT_MS = 5_000;
const MAX_ATTEMPTS = 2; // one retry on network error / timeout / 5xx (SPEC-006-01 R3)

/**
 * Sends OTP codes through an HTTP SMS gateway (FEAT-006,
 * docs/features/FEAT-006-real-sms-otp-delivery): an aggregator, an operator
 * API, or a local gateway (Kannel, Android SIM gateway, `infra/mock-sms`).
 * Generic contract: `POST SMS_HTTP_URL { to, from, body }`, optional
 * `Authorization: Bearer SMS_HTTP_API_KEY`. A gateway with another format
 * gets its own small adapter behind the same `OtpDeliveryPort`.
 *
 * Never logs the code, the SMS body, the key, or the full number.
 */
@Injectable()
export class HttpSmsOtpDeliveryProvider implements OtpDeliveryPort {
  readonly channel = 'sms' as const;
  private readonly logger = new Logger(HttpSmsOtpDeliveryProvider.name);

  constructor(private readonly config: AppConfigService) {}

  async send(input: {
    to: string;
    code: string;
    ttlSeconds: number;
    locale: string;
  }): Promise<void> {
    const url = this.config.get('SMS_HTTP_URL');
    if (!url) throw this.failure('no SMS_HTTP_URL configured');
    const apiKey = this.config.get('SMS_HTTP_API_KEY');
    const payload = JSON.stringify({
      to: input.to,
      from: this.config.get('SMS_SENDER_ID') ?? 'DJAFAT',
      body: otpSmsText(input.code, input.ttlSeconds),
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;
    const to = redactPhone(input.to);

    let lastReason = 'unknown';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: payload,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        await res.body?.cancel();
        if (res.ok) {
          this.logger.log(`OTP SMS accepted by gateway for ${to} (attempt ${attempt})`);
          return;
        }
        lastReason = `gateway answered ${res.status}`;
        if (res.status < 500) break; // a client error will not fix itself
      } catch (err) {
        lastReason =
          err instanceof Error && err.name === 'TimeoutError'
            ? 'gateway timeout'
            : 'gateway unreachable';
      }
      this.logger.warn(
        `OTP SMS attempt ${attempt}/${MAX_ATTEMPTS} for ${to} failed: ${lastReason}`,
      );
    }
    throw this.failure(lastReason);
  }

  private failure(reason: string): HttpException {
    this.logger.error(`OTP SMS delivery failed: ${reason}`);
    return new HttpException(
      {
        code: 'OTP_DELIVERY_FAILED',
        message: "Impossible d'envoyer le SMS, réessayez dans un instant.",
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

function redactPhone(phone: string): string {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
}
