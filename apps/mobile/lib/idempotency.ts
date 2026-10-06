/**
 * A fresh `Idempotency-Key` per write (docs/19 §2). Same reasoning as
 * `apps/courier/lib/idempotency.ts` (Bloc 11): `crypto.randomUUID()` (what
 * `apps/web` uses) is not available under Hermes without a native polyfill,
 * and this key only needs to be unique per action, never unpredictable.
 */
export function newIdempotencyKey(): string {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
