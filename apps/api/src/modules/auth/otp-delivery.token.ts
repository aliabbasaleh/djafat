/** DI token for `OtpDeliveryPort` (`@djafat/types`) — mock in dev/test, `sms` in prod (decision A9). */
export const OTP_DELIVERY_PORT = Symbol('OTP_DELIVERY_PORT');

/** Email channel of the same port (FEAT-007): SMTP in production, mock in dev/CI. */
export const OTP_EMAIL_DELIVERY_PORT = Symbol('OTP_EMAIL_DELIVERY_PORT');

/** WhatsApp channel of the same port (FEAT-008): WhatsApp Cloud API in production, mock in dev/CI. */
export const OTP_WHATSAPP_DELIVERY_PORT = Symbol('OTP_WHATSAPP_DELIVERY_PORT');
