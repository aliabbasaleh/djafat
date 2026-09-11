import { describe, expect, it } from 'vitest';
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateOtpCode,
  generateRefreshToken,
  hashOtpCode,
  hashRefreshToken,
  timingSafeEqualHex,
} from './crypto.util';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64'); // deterministic 32-byte test key

describe('generateOtpCode', () => {
  it('always produces a 6-digit numeric string, zero-padded', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('is not trivially constant across calls (CSPRNG, not a fixed value)', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('hashOtpCode', () => {
  it('is deterministic for the same code + secret', () => {
    expect(hashOtpCode('123456', 'pepper')).toBe(hashOtpCode('123456', 'pepper'));
  });

  it('differs for a different code', () => {
    expect(hashOtpCode('123456', 'pepper')).not.toBe(hashOtpCode('654321', 'pepper'));
  });

  it('differs for a different secret (pepper) — a stolen DB alone is not enough', () => {
    expect(hashOtpCode('123456', 'pepper-a')).not.toBe(hashOtpCode('123456', 'pepper-b'));
  });

  it('never returns the plaintext code as a substring of the hash', () => {
    expect(hashOtpCode('123456', 'pepper')).not.toContain('123456');
  });
});

describe('generateRefreshToken / hashRefreshToken', () => {
  it('generates high-entropy, distinct tokens', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateRefreshToken()));
    expect(tokens.size).toBe(20);
  });

  it('hash is deterministic and never contains the plaintext token', () => {
    const token = generateRefreshToken();
    const hash = hashRefreshToken(token, 'pepper');
    expect(hash).toBe(hashRefreshToken(token, 'pepper'));
    expect(hash).not.toContain(token);
  });
});

describe('timingSafeEqualHex', () => {
  it('returns true for identical hex strings', () => {
    expect(timingSafeEqualHex('deadbeef', 'deadbeef')).toBe(true);
  });

  it('returns false for different hex strings of the same length', () => {
    expect(timingSafeEqualHex('deadbeef', 'deadbeee')).toBe(false);
  });

  it('returns false (not throw) for different-length inputs', () => {
    expect(timingSafeEqualHex('dead', 'deadbeef')).toBe(false);
  });
});

describe('MFA secret at-rest encryption (AES-256-GCM)', () => {
  it('round-trips a TOTP secret exactly', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptMfaSecret(secret, KEY_B64);
    expect(encrypted).not.toContain(secret);
    expect(decryptMfaSecret(encrypted, KEY_B64)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV) even for the same secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(encryptMfaSecret(secret, KEY_B64)).not.toBe(encryptMfaSecret(secret, KEY_B64));
  });

  it('rejects a key that is not exactly 32 bytes', () => {
    const shortKey = Buffer.alloc(16, 1).toString('base64');
    expect(() => encryptMfaSecret('JBSWY3DPEHPK3PXP', shortKey)).toThrow(RangeError);
  });

  it('fails to decrypt with the wrong key (GCM auth tag mismatch)', () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', KEY_B64);
    const wrongKey = Buffer.alloc(32, 9).toString('base64');
    expect(() => decryptMfaSecret(encrypted, wrongKey)).toThrow();
  });

  it('fails to decrypt tampered ciphertext (integrity protected, not just confidentiality)', () => {
    const encrypted = encryptMfaSecret('JBSWY3DPEHPK3PXP', KEY_B64);
    const parts = encrypted.split('.');
    const tampered = [parts[0], parts[1], Buffer.from('tampered-garbage').toString('base64')].join(
      '.',
    );
    expect(() => decryptMfaSecret(tampered, KEY_B64)).toThrow();
  });

  it('rejects a malformed encoded string', () => {
    expect(() => decryptMfaSecret('not-well-formed', KEY_B64)).toThrow(/Malformed/);
  });
});
