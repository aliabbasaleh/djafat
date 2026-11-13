import { describe, expect, it } from 'vitest';
import { OtpRequestSchema, OtpVerifySchema } from './otp-request.schema';

// FEAT-005 — docs/features/FEAT-005-chad-friendly-phone-input (SPEC-005-02).

describe('SPEC-005-02 — OTP endpoints accept a number written the Chadian way', () => {
  // SPEC-005-02-SC01
  it('SPEC-005-02-SC01 — request with a national number is normalised to E.164', () => {
    const parsed = OtpRequestSchema.parse({ phone: '66 12 34 56', purpose: 'login' });
    expect(parsed.phone).toBe('+23566123456');
  });

  // SPEC-005-02-SC02
  it('SPEC-005-02-SC02 — request and verify written differently target the same number', () => {
    const request = OtpRequestSchema.parse({ phone: '00235 66 12 34 56', purpose: 'login' });
    const verify = OtpVerifySchema.parse({ phone: '٦٦١٢٣٤٥٦', code: '123456', purpose: 'login' });
    expect(request.phone).toBe('+23566123456');
    expect(verify.phone).toBe('+23566123456');
  });

  // SPEC-005-02-SC03
  it('SPEC-005-02-SC03 — an invalid number is rejected with an explicit message', () => {
    const result = OtpRequestSchema.safeParse({ phone: '6612345', purpose: 'login' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toMatch(/8 chiffres/);
  });

  // SPEC-005-02-SC04
  it('SPEC-005-02-SC04 — the schema stays strict on unknown fields', () => {
    const result = OtpRequestSchema.safeParse({
      phone: '66123456',
      purpose: 'login',
      role: 'admin',
    });
    expect(result.success).toBe(false);
  });
});
