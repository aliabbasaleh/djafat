/**
 * Destinations shown to a customer or written to a log without revealing
 * them in full (FEAT-007, FEAT-020). Pure.
 */

/** `awa@example.td` -> `a***@example.td` */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}***${email.slice(at)}` : '***';
}

/** `+23566123456` -> `+235 •• •• 34 56`: the country code and the last four digits only. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return '••';
  const country = digits.slice(0, digits.length - 8);
  const last = digits.slice(-4);
  return `${country ? `+${country} ` : ''}•• •• ${last.slice(0, 2)} ${last.slice(2)}`;
}
