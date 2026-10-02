import { describe, expect, it } from 'vitest';
import {
  GrantRoleSchema,
  RevokeRoleQuerySchema,
  RoleParamSchema,
  ReasonSchema,
  SearchUsersQuerySchema,
} from './role-grant.schema';

const RESTAURANT_ID = '11111111-1111-1111-1111-111111111111';

describe('GrantRoleSchema (Bloc 9, docs/30 §role-management)', () => {
  it('accepts a global role with no scope', () => {
    expect(() => GrantRoleSchema.parse({ role: 'courier' })).not.toThrow();
  });

  it('accepts a restaurant-scoped role with a scope', () => {
    const parsed = GrantRoleSchema.parse({
      role: 'restaurant_staff',
      scopeRestaurantId: RESTAURANT_ID,
    });
    expect(parsed.scopeRestaurantId).toBe(RESTAURANT_ID);
  });

  it('rejects an unknown role string (.enum) — never silently coerced', () => {
    expect(() => GrantRoleSchema.parse({ role: 'super_user' })).toThrow();
  });

  it('rejects a malformed scopeRestaurantId (not a uuid)', () => {
    expect(() =>
      GrantRoleSchema.parse({ role: 'restaurant_staff', scopeRestaurantId: 'not-a-uuid' }),
    ).toThrow();
  });

  it('rejects an unknown field outright (.strict())', () => {
    expect(() =>
      GrantRoleSchema.parse({ role: 'courier', permissions: ['admin:write'] }),
    ).toThrow();
  });
});

describe('RevokeRoleQuerySchema', () => {
  it('accepts an empty query (global role revoke)', () => {
    expect(() => RevokeRoleQuerySchema.parse({})).not.toThrow();
  });

  it('rejects a malformed scopeRestaurantId', () => {
    expect(() => RevokeRoleQuerySchema.parse({ scopeRestaurantId: 'xyz' })).toThrow();
  });
});

describe('RoleParamSchema', () => {
  it('accepts every real role', () => {
    for (const role of [
      'customer',
      'restaurant_owner',
      'restaurant_staff',
      'courier',
      'support',
      'finance',
      'admin',
      'super_admin',
    ]) {
      expect(() => RoleParamSchema.parse(role)).not.toThrow();
    }
  });

  it('rejects a path segment that is not a real role — never passed through to a raw SQL IN/= clause unchecked', () => {
    expect(() => RoleParamSchema.parse("admin'; DROP TABLE user_roles; --")).toThrow();
  });
});

describe('ReasonSchema', () => {
  it('rejects an empty reason', () => {
    expect(() => ReasonSchema.parse({ reason: '' })).toThrow();
    expect(() => ReasonSchema.parse({ reason: '   ' })).toThrow();
  });

  it('rejects a reason over 500 characters', () => {
    expect(() => ReasonSchema.parse({ reason: 'a'.repeat(501) })).toThrow();
  });

  it('accepts a normal reason', () => {
    expect(() => ReasonSchema.parse({ reason: 'Fraud report confirmed' })).not.toThrow();
  });
});

describe('SearchUsersQuerySchema (Bloc 9, Phase 11 — negative/overflow pagination)', () => {
  it('rejects page=0 and negative pages', () => {
    expect(() => SearchUsersQuerySchema.parse({ page: 0 })).toThrow();
    expect(() => SearchUsersQuerySchema.parse({ page: -1 })).toThrow();
  });

  it('rejects limit=0 and a limit above the hard cap', () => {
    expect(() => SearchUsersQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => SearchUsersQuerySchema.parse({ limit: 51 })).toThrow();
  });

  it('rejects a non-numeric page/limit rather than coercing to NaN', () => {
    expect(() => SearchUsersQuerySchema.parse({ page: 'abc' })).toThrow();
  });

  it('defaults page/limit when omitted — never undefined reaching the service', () => {
    const parsed = SearchUsersQuerySchema.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
  });

  it('accepts a very large page number — not a validation concern, the service returns an empty page (see users.service.spec.ts)', () => {
    expect(() => SearchUsersQuerySchema.parse({ page: 999_999 })).not.toThrow();
  });
});
