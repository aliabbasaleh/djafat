import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { UsersService, type UserRecord } from './users.service';
import type { AuditService } from '../../common/audit/audit.service';

// "Mon profil" page: the customer sees whether the e-mail is verified (only a
// verified address can be used to log in) and can set the name the courier
// and the restaurant see.

const base: UserRecord = {
  id: 'u-1',
  phone: '+23566000001',
  phoneVerifiedAt: new Date(),
  email: 'awa@gmail.com',
  fullName: null,
  countryId: null,
  locale: 'fr',
  status: 'active',
  createdAt: new Date('2026-11-01T00:00:00Z'),
};

function service(update = vi.fn(async () => ({}))) {
  const prisma = {
    user: {
      update,
      findFirst: vi.fn(async () => ({ ...base, fullName: 'Awa Mahamat', emailVerifiedAt: null })),
    },
  } as unknown as PrismaService;
  return { users: new UsersService(prisma, { log: vi.fn() } as unknown as AuditService), update };
}

describe('profile', () => {
  it('MeDto says whether the e-mail is verified', () => {
    const { users } = service();
    expect(
      users.toMeDto({ ...base, emailVerifiedAt: new Date() }, ['customer']).emailVerified,
    ).toBe(true);
    expect(users.toMeDto({ ...base, emailVerifiedAt: null }, ['customer']).emailVerified).toBe(
      false,
    );
    expect(
      users.toMeDto({ ...base, email: null, emailVerifiedAt: null }, ['customer']).emailVerified,
    ).toBe(false);
  });

  it('updateFullName trims the name and stores it', async () => {
    const { users, update } = service();
    const u = await users.updateFullName('u-1', '  Awa   Mahamat ');
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { fullName: 'Awa Mahamat' },
    });
    expect(u.fullName).toBe('Awa Mahamat');
  });
});
