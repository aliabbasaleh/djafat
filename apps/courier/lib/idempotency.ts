/**
 * A fresh `Idempotency-Key` for one write action (docs/19 §2 — every
 * accept/reject/pickup/deliver/fail needs its own). `crypto.randomUUID()`
 * (what `apps/web` uses) is NOT available under Hermes without an extra
 * native polyfill — this key only needs to be unique per action, never
 * cryptographically unpredictable, so a plain `Math.random()`-based v4-shaped
 * id is the right-sized choice here rather than adding `expo-crypto` for one
 * function.
 */
export function newIdempotencyKey(): string {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
