import { describe, expect, it } from 'vitest';
import {
  base32Encode,
  buildTotpEnrollmentUri,
  generateTotpSecretBase32,
  totpCodeAt,
  verifyTotp,
} from './totp.js';

/** RFC 6238 Appendix B reference secret (ASCII "12345678901234567890"), SHA-1. */
const RFC_6238_SECRET_ASCII = '12345678901234567890';
const RFC_6238_SECRET_B32 = base32Encode(new TextEncoder().encode(RFC_6238_SECRET_ASCII));

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it('matches the RFC 6238 Appendix B test vector at T=59s (8-digit table -> last 6 digits)', async () => {
    // RFC 6238's published 8-digit code at T=59s is 94287082; the HOTP
    // truncation is identical up to the final `mod 10^Digits`, so our
    // 6-digit output must be the last 6 digits of that value: 287082.
    const code = await totpCodeAt(RFC_6238_SECRET_B32, 59_000);
    expect(code).toBe('287082');
  });

  it('matches the RFC 6238 vector at T=1111111109s (-> last 6 of 07081804)', async () => {
    const code = await totpCodeAt(RFC_6238_SECRET_B32, 1_111_111_109_000);
    expect(code).toBe('081804');
  });

  it('matches the RFC 6238 vector at T=1234567890s (-> last 6 of 89005924)', async () => {
    const code = await totpCodeAt(RFC_6238_SECRET_B32, 1_234_567_890_000);
    expect(code).toBe('005924');
  });

  it('verifyTotp accepts the exact current code with stepOffset 0', async () => {
    const result = await verifyTotp(RFC_6238_SECRET_B32, '287082', 59_000);
    expect(result).toEqual({ valid: true, stepOffset: 0 });
  });

  it('verifyTotp accepts a code from the previous 30s step (clock drift) with stepOffset -1', async () => {
    // T=59s -> step 1 (287082). One step later (T=89s, step 2) the code differs;
    // verifying AT T=89s with the step-1 code should still succeed via the window.
    const codeAtStep1 = await totpCodeAt(RFC_6238_SECRET_B32, 59_000);
    const result = await verifyTotp(RFC_6238_SECRET_B32, codeAtStep1, 89_000);
    expect(result).toEqual({ valid: true, stepOffset: -1 });
  });

  it('verifyTotp rejects a code more than 1 step away', async () => {
    const codeAtStep1 = await totpCodeAt(RFC_6238_SECRET_B32, 59_000);
    const result = await verifyTotp(RFC_6238_SECRET_B32, codeAtStep1, 149_000); // 3 steps later
    expect(result).toEqual({ valid: false, stepOffset: null });
  });

  it('verifyTotp rejects a malformed code without computing anything', async () => {
    expect(await verifyTotp(RFC_6238_SECRET_B32, '12', 59_000)).toEqual({
      valid: false,
      stepOffset: null,
    });
    expect(await verifyTotp(RFC_6238_SECRET_B32, 'abcdef', 59_000)).toEqual({
      valid: false,
      stepOffset: null,
    });
  });

  it('generateTotpSecretBase32 rejects fewer than 20 bytes', () => {
    expect(() => generateTotpSecretBase32(new Uint8Array(10))).toThrow(RangeError);
  });

  it('generateTotpSecretBase32 produces a secret that round-trips through verifyTotp', async () => {
    const secret = generateTotpSecretBase32(crypto.getRandomValues(new Uint8Array(20)));
    const code = await totpCodeAt(secret, Date.now());
    const result = await verifyTotp(secret, code);
    expect(result.valid).toBe(true);
  });

  it('base32Encode matches the RFC 4648 §10 test vectors (unpadded)', () => {
    const enc = (s: string) => base32Encode(new TextEncoder().encode(s));
    expect(enc('f')).toBe('MY');
    expect(enc('fo')).toBe('MZXQ');
    expect(enc('foo')).toBe('MZXW6');
    expect(enc('foob')).toBe('MZXW6YQ');
    expect(enc('fooba')).toBe('MZXW6YTB');
    expect(enc('foobar')).toBe('MZXW6YTBOI');
  });

  it('buildTotpEnrollmentUri produces a well-formed otpauth:// URI, never leaking via logs by itself', () => {
    const uri = buildTotpEnrollmentUri({
      secretBase32: RFC_6238_SECRET_B32,
      accountLabel: '+23566000099',
      issuer: 'DJAFAT',
    });
    expect(uri).toMatch(/^otpauth:\/\/totp\/DJAFAT%3A/);
    expect(uri).toContain(`secret=${RFC_6238_SECRET_B32}`);
    expect(uri).toContain('algorithm=SHA1');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
