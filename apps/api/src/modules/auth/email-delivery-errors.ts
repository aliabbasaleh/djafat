import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * The two ways an account e-mail cannot leave (FEAT-007, FEAT-020), shared by
 * the code transports and by registration, so an address that already has an
 * account fails exactly like a free one (review FEAT-020 #3).
 */
export function emailDeliveryFailed(): HttpException {
  return new HttpException(
    {
      code: 'OTP_DELIVERY_FAILED',
      message: "Impossible d'envoyer l'e-mail, réessayez dans un instant.",
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}

export function emailUnavailable(): HttpException {
  return new HttpException(
    {
      code: 'EMAIL_UNAVAILABLE',
      message: "La connexion par e-mail n'est pas disponible pour le moment.",
    },
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
