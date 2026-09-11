/**
 * TOTP (RFC 6238) over HOTP (RFC 4226), HMAC-SHA1 — the universal algorithm
 * every authenticator app (Google Authenticator, Authy, 1Password, ...)
 * assumes. Implemented against the Web Crypto API (`crypto.subtle`), which
 * is a GLOBAL in Node 19+ and in every modern browser — no `node:crypto`
 * import, so `@djafat/core` stays isomorphic (docs/19 §22).
 *
 * Pure w.r.t. I/O (no DB, no env) — only `Date.now()` for the default clock,
 * injectable for deterministic tests.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEFAULT_DIGITS = 6;
const DEFAULT_STEP_SECONDS = 30;
/** How many steps before/after "now" still verify — absorbs client clock drift. */
const DEFAULT_WINDOW = 1;

/** Random 20-byte (160-bit) secret, base32-encoded — the TOTP standard length. */
export function generateTotpSecretBase32(randomBytes: Uint8Array): string {
  if (randomBytes.length < 20) {
    throw new RangeError('TOTP secret needs at least 20 random bytes (160 bits).');
  }
  return base32Encode(randomBytes);
}

/** `otpauth://totp/...` URI for QR-code enrollment (docs/19 §22). */
export function buildTotpEnrollmentUri(input: {
  secretBase32: string;
  accountLabel: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${input.issuer}:${input.accountLabel}`);
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(DEFAULT_DIGITS),
    period: String(DEFAULT_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The 6-digit code for a given HOTP counter (RFC 4226 §5.3). */
async function hotp(secretBase32: string, counter: bigint): Promise<string> {
  const keyBytes = base32Decode(secretBase32);
  const counterBytes = new ArrayBuffer(8);
  new DataView(counterBytes).setBigUint64(0, counter, false); // big-endian

  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));

  const offset = mac[mac.length - 1]! & 0x0f;
  const binCode =
    ((mac[offset]! & 0x7f) << 24) |
    ((mac[offset + 1]! & 0xff) << 16) |
    ((mac[offset + 2]! & 0xff) << 8) |
    (mac[offset + 3]! & 0xff);
  return String(binCode % 10 ** DEFAULT_DIGITS).padStart(DEFAULT_DIGITS, '0');
}

/** The current TOTP code for `secretBase32` (used only by tests/enrollment previews). */
export async function totpCodeAt(secretBase32: string, atMs: number): Promise<string> {
  const counter = BigInt(Math.floor(atMs / 1000 / DEFAULT_STEP_SECONDS));
  return hotp(secretBase32, counter);
}

/**
 * Verifies `code` against `secretBase32` at time `atMs`, tolerating
 * `±window` steps of clock drift (default ±30 s). Returns the matched step
 * OFFSET (0 = exact, ±1 = drift) so the caller can log/monitor drift — not
 * just a boolean, so step-up auditing (docs/19 §23) can note "code was N
 * steps off" without exposing the secret.
 */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  atMs: number = Date.now(),
  window: number = DEFAULT_WINDOW,
): Promise<{ valid: boolean; stepOffset: number | null }> {
  if (!/^\d{6}$/.test(code)) return { valid: false, stepOffset: null };
  const counter = BigInt(Math.floor(atMs / 1000 / DEFAULT_STEP_SECONDS));
  for (let delta = -window; delta <= window; delta++) {
    const candidate = await hotp(secretBase32, counter + BigInt(delta));
    if (timingSafeEqualString(candidate, code)) {
      return { valid: true, stepOffset: delta };
    }
  }
  return { valid: false, stepOffset: null };
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Exported for tests and for enrollment flows that need to encode a known secret. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return output;
}

function base32Decode(encoded: string): Uint8Array {
  const clean = encoded.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue; // ignore separators/whitespace defensively
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
