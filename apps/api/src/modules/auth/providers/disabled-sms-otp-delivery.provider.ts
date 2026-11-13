import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { OtpDeliveryPort } from '@djafat/types';

/** The one 503 SMS_UNAVAILABLE (FEAT-008), also raised early by `OtpService`. */
export function smsUnavailable(): HttpException {
  return new HttpException(
    {
      code: 'SMS_UNAVAILABLE',
      message: "La connexion par SMS n'est pas disponible. Utilisez WhatsApp.",
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

/**
 * `SMS_PROVIDER=disabled` (FEAT-008): no paid SMS at launch. Every SMS code
 * request fails with 503 SMS_UNAVAILABLE and `GET /v1/auth/methods` reports
 * SMS as unavailable, so the app offers WhatsApp instead.
 */
@Injectable()
export class DisabledSmsOtpDeliveryProvider implements OtpDeliveryPort {
  readonly channel = 'sms' as const;

  send(_input: { to: string; code: string; ttlSeconds: number; locale: string }): Promise<void> {
    return Promise.reject(smsUnavailable());
  }
}
