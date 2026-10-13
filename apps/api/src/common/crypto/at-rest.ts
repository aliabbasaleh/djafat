import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for values that must survive a restart but must
 * never sit in plaintext at rest — the delivery proof code (docs/25 §B6.1-7,
 * pilot fix in docs/36) being the first.
 *
 * Deliberately separate from `modules/auth/crypto.util.ts`'s
 * `encryptMfaSecret`/`decryptMfaSecret`, which are mechanically identical but
 * bound to `MFA_ENCRYPTION_KEY`: reusing ONE key across two unrelated secret
 * domains means a single key rotation or leak spans both. Same algorithm,
 * separate key, separate call site.
 */

const GCM_IV_BYTES = 12;
const AES_256_KEY_BYTES = 32;

function keyOf(keyBase64: string, keyName: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== AES_256_KEY_BYTES) {
    throw new RangeError(`${keyName} must decode to exactly 32 bytes (AES-256).`);
  }
  return key;
}

/** `base64(iv) . base64(authTag) . base64(ciphertext)`, `.`-joined. */
export function encryptAtRest(plaintext: string, keyBase64: string, keyName: string): string {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyOf(keyBase64, keyName), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/** Throws if the payload was tampered with (GCM auth tag) or is malformed. */
export function decryptAtRest(encoded: string, keyBase64: string, keyName: string): string {
  const [ivB64, tagB64, ciphertextB64] = encoded.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted-at-rest payload.');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyOf(keyBase64, keyName),
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
