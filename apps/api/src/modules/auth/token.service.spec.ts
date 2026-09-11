import { describe, expect, it } from 'vitest';
import { TokenService } from './token.service';
import type { AppConfigService } from '../../common/config/config.service';

interface ConfigOverrides {
  JWT_ACCESS_SECRET?: string;
  JWT_ACCESS_TTL_SECONDS?: number;
  JWT_ISSUER?: string;
  JWT_AUDIENCE?: string;
}

const configStub = (overrides: ConfigOverrides = {}): AppConfigService => {
  const values: Required<ConfigOverrides> = {
    JWT_ACCESS_SECRET: 'test-secret',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_ISSUER: 'djafat-api',
    JWT_AUDIENCE: 'djafat-clients',
    ...overrides,
  };
  return { get: (key: keyof ConfigOverrides) => values[key] } as unknown as AppConfigService;
};

describe('TokenService', () => {
  it('signs a token that verifies back to the same payload', () => {
    const svc = new TokenService(configStub());
    const { token, expiresAt } = svc.signAccessToken({
      userId: 'u1',
      sessionId: 's1',
      roles: ['customer'],
    });
    const payload = svc.verifyAccessToken(token);
    expect(payload.sub).toBe('u1');
    expect(payload.sid).toBe('s1');
    expect(payload.roles).toEqual(['customer']);
    expect(payload.iss).toBe('djafat-api');
    expect(payload.aud).toBe('djafat-clients');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects a token signed with a different secret', () => {
    const issuer = new TokenService(configStub({ JWT_ACCESS_SECRET: 'secret-a' }));
    const verifier = new TokenService(configStub({ JWT_ACCESS_SECRET: 'secret-b' }));
    const { token } = issuer.signAccessToken({ userId: 'u1', sessionId: 's1', roles: [] });
    expect(() => verifier.verifyAccessToken(token)).toThrow(/Invalid token signature/);
  });

  it('rejects an expired token', () => {
    const svc = new TokenService(configStub({ JWT_ACCESS_TTL_SECONDS: -1 }));
    const { token } = svc.signAccessToken({ userId: 'u1', sessionId: 's1', roles: [] });
    expect(() => svc.verifyAccessToken(token)).toThrow(/expired/);
  });

  it('rejects a token with the wrong issuer', () => {
    const issuer = new TokenService(configStub({ JWT_ISSUER: 'someone-else' }));
    const verifier = new TokenService(configStub());
    const { token } = issuer.signAccessToken({ userId: 'u1', sessionId: 's1', roles: [] });
    expect(() => verifier.verifyAccessToken(token)).toThrow(/issuer/);
  });

  it('rejects a token with the wrong audience', () => {
    const issuer = new TokenService(configStub({ JWT_AUDIENCE: 'someone-else' }));
    const verifier = new TokenService(configStub());
    const { token } = issuer.signAccessToken({ userId: 'u1', sessionId: 's1', roles: [] });
    expect(() => verifier.verifyAccessToken(token)).toThrow(/issuer/);
  });

  it('rejects a malformed token (wrong number of segments)', () => {
    const svc = new TokenService(configStub());
    expect(() => svc.verifyAccessToken('not.a.jwt.at.all')).toThrow(/Malformed token\./);
    expect(() => svc.verifyAccessToken('onlyonesegment')).toThrow(/Malformed token\./);
  });

  it('rejects a token with a tampered payload (signature no longer matches)', () => {
    const svc = new TokenService(configStub());
    const { token } = svc.signAccessToken({ userId: 'u1', sessionId: 's1', roles: ['customer'] });
    const [header, payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')),
        roles: ['super_admin'], // privilege escalation attempt
      }),
    ).toString('base64url');
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
    expect(() => svc.verifyAccessToken(tamperedToken)).toThrow(/Invalid token signature/);
  });

  it('never embeds the JWT secret itself in the token', () => {
    const svc = new TokenService(configStub({ JWT_ACCESS_SECRET: 'super-secret-value' }));
    const { token } = svc.signAccessToken({ userId: 'u1', sessionId: 's1', roles: [] });
    expect(token).not.toContain('super-secret-value');
  });
});
