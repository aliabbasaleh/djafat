import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';
import { RedisService } from '../../../common/redis/redis.service';
import { AppConfigService } from '../../../common/config/config.service';

/**
 * Dev/CI WhatsApp transport (FEAT-008), same idea as the SMS and email mocks:
 * the code is readable in Redis under a short TTL, never logged. In
 * production it answers 503 WHATSAPP_UNAVAILABLE (the methods registry
 * already reports WhatsApp as unavailable there).
 */
@Injectable()
export class MockWhatsappOtpDeliveryProvider implements OtpDeliveryPort {
  readonly channel = 'whatsapp' as const;

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
      throw new HttpException(
        {
          code: 'WHATSAPP_UNAVAILABLE',
          message: "La connexion par WhatsApp n'est pas disponible pour le moment.",
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.redis.client.set(mockWhatsappOtpKey(input.to), input.code, 'EX', input.ttlSeconds);
  }
}

export function mockWhatsappOtpKey(phone: string): string {
  return `otp:mock:whatsapp:${phone}`;
}
