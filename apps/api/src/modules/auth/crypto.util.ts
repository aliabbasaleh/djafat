import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Every secret-handling primitive the `auth` module needs — OTP code
 * hashing, refresh-token hashing, TOTP secret at-rest encryption. Pure
 * functions only (no DB/Redis); callers own persistence (docs/19 §7, §14,
 * §22, §40 — "never log a secret").
 */

// ── OTP codes ────────────────────────────────────────────────────────────

/** A cryptographically random 6-digit numeric code (never `Math.random`). */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** HMAC-SHA256(code, pepper) — the OTP is never stored in plaintext. */
export function hashOtpCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code).digest('hex');
}

// ── Refresh tokens ───────────────────────────────────────────────────────

/** 32 random bytes, base64url — high entropy, no hashing algorithm needed for the token itself. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 HMAC of the refresh token — what's actually persisted in `sessions.refresh_hash`. */
export function hashRefreshToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

// ── Constant-time comparison ─────────────────────────────────────────────

/** Constant-time hex-string comparison — never `===` on a secret-derived hash. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── TOTP secret at-rest encryption (AES-256-GCM) ────────────────────────

const GCM_IV_BYTES = 12;

/** `base64(iv) . base64(authTag) . base64(ciphertext)`, `.`-joined. */
export function encryptMfaSecret(plainBase32Secret: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new RangeError('MFA_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
  }
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainBase32Secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    '.',
  );
}

export function decryptMfaSecret(encoded: string, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const [ivB64, tagB64, ciphertextB64] = encoded.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted MFA secret.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}
