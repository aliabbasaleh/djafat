/** DI token for `OtpDeliveryPort` (`@djafat/types`) — mock in dev/test, `sms` in prod (decision A9). */
export const OTP_DELIVERY_PORT = Symbol('OTP_DELIVERY_PORT');

/** Email channel of the same port (FEAT-007): SMTP in production, mock in dev/CI. */
export const OTP_EMAIL_DELIVERY_PORT = Symbol('OTP_EMAIL_DELIVERY_PORT');

// FEAT-023 (SPEC-023-08 R1): no WhatsApp channel — DJAFAT never sends a code by
// WhatsApp; the customer sends the code shown on screen (`WhatsappCodeService`).
