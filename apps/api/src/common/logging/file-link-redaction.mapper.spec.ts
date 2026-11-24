import { describe, expect, it } from 'vitest';
import { withoutFileSignature } from './file-link-redaction.mapper';

describe('withoutFileSignature (FEAT-022, SPEC-022-04 R3)', () => {
  it('a private photo link is logged without its signature', () => {
    expect(
      withoutFileSignature({
        method: 'GET',
        url: '/v1/files/private-0d0f.jpg?exp=1795432000&sig=abc',
        query: { exp: '1795432000', sig: 'abc' },
      }),
    ).toEqual({ method: 'GET', url: '/v1/files/private-0d0f.jpg?[redacted]', query: '[redacted]' });
  });

  it('every other request is logged as is', () => {
    const req = { method: 'POST', url: '/v1/auth/login?next=/profil', query: { next: '/profil' } };
    expect(withoutFileSignature(req)).toBe(req);
  });
});
