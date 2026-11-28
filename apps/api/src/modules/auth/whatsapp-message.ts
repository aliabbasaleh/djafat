/**
 * FEAT-023 — the message a customer sends to DJAFAT on WhatsApp, and how a
 * received message is read (SPEC-023-01 R3-R4, SPEC-023-02 R3). Pure.
 */

/** What a code is for: a login, a new device's code (password login), a number to confirm. */
export type WhatsappCodePurpose = 'login' | 'login_device' | 'verify_phone';

/**
 * SPEC-023-01 R3: the message written for the customer, with the warning the
 * user chose (FEAT-023-Q03) — adapted for a confirmation (FEAT-023-Q05).
 */
export function whatsappMessageText(code: string, purpose: WhatsappCodePurpose): string {
  return purpose === 'verify_phone'
    ? `Je confirme mon numéro sur DJAFAT : ${code} (n'envoyez ce code que pour votre propre compte)`
    : `Je me connecte à DJAFAT : ${code} (n'envoyez ce code que pour vous connecter vous-même)`;
}

/** SPEC-023-01 R4: WhatsApp opened on DJAFAT's number (E.164) with the message ready to send. */
export function whatsappLink(businessNumber: string, text: string): string {
  return `https://wa.me/${businessNumber.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

/** Six digits that touch no other digit (a phone number or an amount is not a code). */
const CODE = /(?<!\d)\d{6}(?!\d)/g;

/**
 * SPEC-023-02 R3 (FEAT-023-Q07): the code a message carries — « DJAFAT »
 * anywhere (case and accents ignored) and one 6-digit number; `null` for any
 * other message, « Code DJAFAT » (FEAT-008) included.
 */
export function readWhatsappCode(text: string): string | null {
  const plain = text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  if (!plain.includes('djafat')) return null;
  const codes = new Set([...text.matchAll(CODE)].map((m) => m[0]));
  if (codes.size !== 1) return null;
  const [code] = codes;
  return code ?? null;
}
