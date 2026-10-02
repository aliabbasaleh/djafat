import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from './audit.service';

interface AuditRow {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
  createdAt: Date;
}

function fakePrisma(rows: AuditRow[] = []) {
  return {
    auditLog: {
      create: vi.fn((args: { data: Record<string, unknown> }) => {
        rows.push({
          id: `row-${rows.length}`,
          actorUserId: (args.data['actorUserId'] as string) ?? null,
          action: args.data['action'] as string,
          entityType: args.data['entityType'] as string,
          entityId: (args.data['entityId'] as string) ?? null,
          before: args.data['before'] ?? null,
          after: args.data['after'] ?? null,
          metadata: args.data['metadata'] ?? null,
          createdAt: new Date(),
        });
        return Promise.resolve(undefined);
      }),
      findMany: vi.fn((args: { where: { entityType: string; entityId: string }; take: number }) =>
        Promise.resolve(
          rows
            .filter(
              (r) => r.entityType === args.where.entityType && r.entityId === args.where.entityId,
            )
            .slice(0, args.take),
        ),
      ),
    },
  } as unknown as PrismaService;
}

describe('AuditService', () => {
  it('log() writes an entry that listForEntity() then reads back', async () => {
    const prisma = fakePrisma();
    const service = new AuditService(prisma);

    await service.log({
      actorUserId: 'admin-1',
      action: 'ROLE_GRANTED',
      entityType: 'user',
      entityId: 'user-1',
      after: { role: 'courier' },
    });

    const history = await service.listForEntity('user', 'user-1');
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ actorUserId: 'admin-1', action: 'ROLE_GRANTED' });
  });

  it('listForEntity() never returns another entity’s history', async () => {
    const prisma = fakePrisma();
    const service = new AuditService(prisma);
    await service.log({
      actorUserId: 'a',
      action: 'ROLE_GRANTED',
      entityType: 'user',
      entityId: 'user-1',
    });
    await service.log({
      actorUserId: 'a',
      action: 'ROLE_GRANTED',
      entityType: 'user',
      entityId: 'user-2',
    });

    const history = await service.listForEntity('user', 'user-1');
    expect(history).toHaveLength(1);
  });

  it('log() swallows a write failure — never breaks the caller’s flow (docs/19 §24)', async () => {
    const prisma = {
      auditLog: { create: vi.fn().mockRejectedValue(new Error('db down')) },
    } as unknown as PrismaService;
    const service = new AuditService(prisma);

    await expect(
      service.log({ actorUserId: 'a', action: 'ROLE_GRANTED', entityType: 'user', entityId: 'u1' }),
    ).resolves.toBeUndefined();
  });
});
