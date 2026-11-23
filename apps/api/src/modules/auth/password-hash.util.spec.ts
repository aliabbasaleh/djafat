import { vi, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password-hash.util';

// Real scrypt (N=2^15) on purpose: on the Windows CI runner, ten verifications take longer than
// vitest's 5 s default (PR #27, « local setup on Windows »). A longer limit, not a weaker test.
vi.setConfig({ testTimeout: 30_000 });

// FEAT-020 — docs/features/FEAT-020-compte-email-mot-de-passe (SPEC-020-02 R7).
// Real scrypt, no fake: this is the stored format.

describe('SPEC-020-02 — password storage', () => {
  // SPEC-020-02-SC07
  it('SPEC-020-02-SC07 — salted hashes, exact verification, malformed hashes refused', async () => {
    const password = 'kissar-boulou-27';
    const first = await hashPassword(password);
    const second = await hashPassword(password);

    expect(first).not.toBe(second);
    for (const hash of [first, second]) {
      expect(hash.startsWith('scrypt$32768$8$3$')).toBe(true);
      expect(hash).not.toContain(password);
    }

    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword(password, second)).toBe(true);
    expect(await verifyPassword('kissar-boulou-28', first)).toBe(false);

    for (const malformed of [
      '',
      'kissar-boulou-27',
      'bcrypt$32768$8$3$c2FsdA$aGFzaA',
      'scrypt$32768$8$3$onlyfive',
      'scrypt$99999999$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      'scrypt$abc$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ]) {
      expect(await verifyPassword(password, malformed), malformed).toBe(false);
    }
  });

  it('SPEC-020-02-SC07 — composed and decomposed accents are the same password (NFKC)', async () => {
    const hash = await hashPassword('café-noir-27');
    expect(await verifyPassword('café-noir-27', hash)).toBe(true);
  });
});
