import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PhotoType } from './photo-file';

/**
 * FEAT-022 (SPEC-022-04 R1 to R4): a stored file's key says its family —
 * `private-<uuid>.jpg` (papers: read only through a signed 5-minute link) or
 * `public-<uuid>.png` (logos, covers) — and nothing else: a random id, never
 * the uploaded name. One flat segment, so `GET /files/:key` needs no wildcard
 * and a key can never climb out of the storage folder.
 */

export type FileFamily = 'private' | 'public';

const KEY_SHAPE =
  /^(private|public)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;

export function newFileKey(family: FileFamily, type: PhotoType): string {
  return `${family}-${randomUUID()}.${type}`;
}

export function parseFileKey(key: string): { family: FileFamily; type: PhotoType } | null {
  const match = KEY_SHAPE.exec(key);
  if (!match) return null;
  return { family: match[1] as FileFamily, type: match[3] as PhotoType };
}

/** HMAC-SHA256 of `<key>.<expires>` (unix seconds), base64url. */
export function signFileKey(key: string, expiresAt: number, secret: string): string {
  return createHmac('sha256', secret).update(`${key}.${expiresAt}`).digest('base64url');
}

/** R3: right signature and not expired; compared in constant time. */
export function verifyFileSignature(
  key: string,
  expiresAt: string | undefined,
  signature: string | undefined,
  secret: string,
  nowSeconds: number,
): boolean {
  if (!expiresAt || !signature || !/^\d{1,12}$/.test(expiresAt)) return false;
  const exp = Number(expiresAt);
  if (exp < nowSeconds) return false;
  const expected = Buffer.from(signFileKey(key, exp, secret));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
