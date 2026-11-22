import { Injectable } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
import { RedisService } from '../../../common/redis/redis.service';
import { AppConfigService } from '../../../common/config/config.service';
import { emailUnavailable } from '../email-delivery-errors';

/**
 * Dev/CI email transport (FEAT-007), same idea as `MockOtpDeliveryProvider`:
 * the code is readable in Redis under a short TTL, never logged. In
 * production the email channel is simply unavailable (503
 * EMAIL_UNAVAILABLE): email login is optional, SMS keeps working.
 */
@Injectable()
export class MockEmailOtpDeliveryProvider implements OtpDeliveryPort {
  readonly channel = 'email' as const;

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
    if (this.config.isProduction) {
      throw emailUnavailable();
    }
    await this.redis.client.set(mockEmailOtpKey(input.to), input.code, 'EX', input.ttlSeconds);
  }
}

export function mockEmailOtpKey(email: string): string {
  return `otp:mock:email:${email}`;
}
