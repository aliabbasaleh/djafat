import { Injectable, Logger } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
import { RedisService } from '../../../common/redis/redis.service';
import { AppConfigService } from '../../../common/config/config.service';

/**
 * Deterministic, permanent OTP transport for dev/CI (docs/19 §6) — the same
 * "mock is a first-class citizen, not a stub" philosophy as
 * `MockPaymentProvider` (Bloc 0). Never logs the code (docs/19 §7, §40): to
 * stay testable without a real SMS gateway, it stashes the code in Redis
 * under a short TTL, NON-production only — an ephemeral side channel a test
 * can read directly, not a log line that could end up in an aggregator.
 */
@Injectable()
export class MockOtpDeliveryProvider implements OtpDeliveryPort {
  readonly channel = 'sms' as const;
  private readonly logger = new Logger(MockOtpDeliveryProvider.name);

  constructor(
    private readonly redis: RedisService,
    private readonly config: AppConfigService,
  ) {}

  async send(input: {
    to: string;
    code: string;
    ttlSeconds: number;
    locale: string;
  }): Promise<void> {
    this.logger.debug(`[mock-otp] would deliver an SMS to ${redactPhone(input.to)}`);
    if (!this.config.isProduction) {
      await this.redis.client.set(mockOtpKey(input.to), input.code, 'EX', input.ttlSeconds);
    }
  }
}

export function mockOtpKey(phone: string): string {
  return `otp:mock:${phone}`;
}

function redactPhone(phone: string): string {
  return phone.length > 4 ? `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}` : '****';
}
