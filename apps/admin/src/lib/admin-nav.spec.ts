import { describe, expect, it } from 'vitest';
import { isAllowedPath } from './admin-nav';

const FULL = [{ href: '/admin' }, { href: '/admin/users' }, { href: '/admin/applications' }];
const SUPPORT = [{ href: '/admin/phone-order' }, { href: '/admin/orders' }];

describe('isAllowedPath — the console’s page gate', () => {
  it('SPEC-022-07-SC07 — a full admin opens a courier’s application and a user’s detail page', () => {
    expect(isAllowedPath('/admin/applications', FULL)).toBe(true);
    expect(isAllowedPath('/admin/applications/courier/7d1c', FULL)).toBe(true);
    expect(isAllowedPath('/admin/users/7d1c', FULL)).toBe(true);
  });

  it('SPEC-022-07 « Autorisations » — support never reaches the queue, not even a detail page', () => {
    expect(isAllowedPath('/admin/applications', SUPPORT)).toBe(false);
    expect(isAllowedPath('/admin/applications/courier/7d1c', SUPPORT)).toBe(false);
  });

  it('the dashboard entry does not open every page under /admin', () => {
    expect(isAllowedPath('/admin/finance', [{ href: '/admin' }])).toBe(false);
    expect(isAllowedPath('/admin/usersX', FULL)).toBe(false);
  });
});
