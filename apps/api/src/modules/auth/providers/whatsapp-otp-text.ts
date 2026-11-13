/**
 * WhatsApp reply carrying the login code (FEAT-008, SPEC-008-04 R1). Sent as
 * a free-form service reply, so accents and line breaks are fine (unlike SMS).
 * The warning targets the usual scam: "a courier/DJAFAT agent asks for your code".
 */
export function whatsappOtpText(code: string, ttlSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(ttlSeconds / 60));
  return [
    `Votre code DJAFAT : *${code}*`,
    `Valable ${minutes} min.`,
    "Ne le donnez à personne, même à un livreur ou à quelqu'un qui dit appeler de la part de DJAFAT.",
  ].join('\n');
}
