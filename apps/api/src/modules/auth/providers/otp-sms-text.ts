/**
 * Text of the login-code SMS (FEAT-006, SPEC-006-01 R1). ASCII only: a single
 * GSM-7 segment on every handset, no accent turned into "?" by old phones.
 */
export function otpSmsText(code: string, ttlSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  return `DJAFAT : votre code est ${code}. Valable ${minutes} min. Ne le communiquez a personne.`;
}
