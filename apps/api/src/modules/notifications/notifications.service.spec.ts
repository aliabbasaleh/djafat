import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { PushPort } from '@djafat/types';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import { NotificationsService } from './notifications.service';

/**
 * Bloc 7 §20 — notifications: persistence, isolation, deduplication.
 *
 * The fake enforces the REAL unique constraint from migration 0026
 * (`notifications_dedup_uk`) rather than trusting the service to behave: the
 * whole point of `ON CONFLICT DO NOTHING` is that the DATABASE, not the code,
 * is what makes a redelivered event produce one row. A fake that let duplicates
 * through would test nothing.
 */

interface Row {
  id: string;
  userId: string;
  type: string;
  titleKey: string;
  bodyKey: string;
  data: unknown;
  referenceAggregate: string | null;
  referenceId: string | null;
  dedupKey: string;
  createdAt: Date;
  readAt: Date | null;
}
interface DeviceRow {
  id: string;
  userId: string;
  platform: string;
  pushToken: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

let notifications: Row[] = [];
let devices: DeviceRow[] = [];

function makeDb(): PrismaService {
  return {
    // `notifyUser`'s raw INSERT ... ON CONFLICT DO NOTHING RETURNING id.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      await Promise.resolve();
      const text = strings.join('?');
      if (!text.includes('INSERT INTO notifications')) {
        throw new Error(`Unhandled $queryRaw: ${text}`);
      }
      const [userId, type, titleKey, bodyKey, dataJson, refAggregate, refId, dedupKey] = values as [
        string,
        string,
        string,
        string,
        string,
        string | null,
        string | null,
        string,
      ];

      // The unique constraint, enforced for real.
      if (notifications.some((n) => n.userId === userId && n.dedupKey === dedupKey)) {
        return []; // ON CONFLICT DO NOTHING -> no RETURNING row
      }
      const row: Row = {
        id: randomUUID(),
        userId,
        type,
        titleKey,
        bodyKey,
        data: JSON.parse(dataJson),
        referenceAggregate: refAggregate,
        referenceId: refId,
        dedupKey,
        createdAt: new Date(),
        readAt: null,
      };
      notifications.push(row);
      return [{ id: row.id }];
    }),
    notification: {
      findMany: vi.fn(async (args: { where: { userId: string }; skip?: number; take?: number }) => {
        await Promise.resolve();
        const mine = notifications
          .filter((n) => n.userId === args.where.userId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return mine.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? mine.length));
      }),
      count: vi.fn(async (args: { where: { userId: string; readAt?: null } }) => {
        await Promise.resolve();
        return notifications.filter(
          (n) =>
            n.userId === args.where.userId &&
            (args.where.readAt === undefined || n.readAt === null),
        ).length;
      }),
      updateMany: vi.fn(
        async (args: {
          where: { id: string; userId: string; readAt: null };
          data: { readAt: Date };
        }) => {
          await Promise.resolve();
          const row = notifications.find(
            (n) => n.id === args.where.id && n.userId === args.where.userId && n.readAt === null,
          );
          if (!row) return { count: 0 };
          row.readAt = args.data.readAt;
          return { count: 1 };
        },
      ),
      findFirst: vi.fn(async (args: { where: { id: string; userId: string } }) => {
        await Promise.resolve();
        return (
          notifications.find((n) => n.id === args.where.id && n.userId === args.where.userId) ??
          null
        );
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        await Promise.resolve();
        return notifications.find((n) => n.id === args.where.id) ?? null;
      }),
      findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
        await Promise.resolve();
        const row = notifications.find((n) => n.id === args.where.id);
        if (!row) throw new Error('not found');
        return row;
      }),
    },
    notificationDevice: {
      findMany: vi.fn(async (args: { where: { userId: string; revokedAt: null } }) => {
        await Promise.resolve();
        return devices.filter((d) => d.userId === args.where.userId && d.revokedAt === null);
      }),
      findFirst: vi.fn(async (args: { where: { id: string; userId: string } }) => {
        await Promise.resolve();
        return (
          devices.find((d) => d.id === args.where.id && d.userId === args.where.userId) ?? null
        );
      }),
      upsert: vi.fn(
        async (args: {
          where: { pushToken: string };
          create: { userId: string; platform: string; pushToken: string };
          update: { userId: string; platform: string; lastSeenAt: Date; revokedAt: null };
        }) => {
          await Promise.resolve();
          const existing = devices.find((d) => d.pushToken === args.where.pushToken);
          if (existing) {
            Object.assign(existing, args.update);
            return existing;
          }
          const row: DeviceRow = {
            id: randomUUID(),
            createdAt: new Date(),
            lastSeenAt: new Date(),
            revokedAt: null,
            ...args.create,
          };
          devices.push(row);
          return row;
        },
      ),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<DeviceRow> }) => {
        await Promise.resolve();
        const row = devices.find((d) => d.id === args.where.id)!;
        Object.assign(row, args.data);
        return row;
      }),
      updateMany: vi.fn(
        async (args: {
          where: { id: string; userId: string; revokedAt: null };
          data: { revokedAt: Date };
        }) => {
          await Promise.resolve();
          const row = devices.find(
            (d) => d.id === args.where.id && d.userId === args.where.userId && d.revokedAt === null,
          );
          if (!row) return { count: 0 };
          row.revokedAt = args.data.revokedAt;
          return { count: 1 };
        },
      ),
    },
  } as unknown as PrismaService;
}

function makePush(
  behaviour: (token: string) => { delivered: boolean; shouldRevoke: boolean } | Error = () => ({
    delivered: true,
    shouldRevoke: false,
  }),
): { port: PushPort; sent: string[] } {
  const sent: string[] = [];
  const port = {
    send: vi.fn(async (input: { token: string }) => {
      await Promise.resolve();
      const result = behaviour(input.token);
      if (result instanceof Error) throw result;
      // `sent` means DELIVERED, not merely attempted — a provider that reports
      // a dead token has not delivered anything.
      if (result.delivered) sent.push(input.token);
      return result;
    }),
  } as unknown as PushPort;
  return { port, sent };
}

const ALICE = 'user-alice';
const BOB = 'user-bob';

function notifyInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: ALICE,
    type: 'order.delivered' as const,
    titleKey: 'notifications.order.delivered.title',
    bodyKey: 'notifications.order.delivered.body',
    data: { orderId: 'order-1' },
    referenceAggregate: 'order',
    referenceId: '11111111-1111-1111-1111-111111111111',
    dedupKey: 'outbox-row-1',
    ...overrides,
  };
}

beforeEach(() => {
  notifications = [];
  devices = [];
});

describe('a notification is persisted and observable (Bloc 7 §15, §20)', () => {
  it('creates a row the user can then read back', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);

    const result = await service.notifyUser(notifyInput());
    expect(result.created).toBe(true);

    const listed = await service.list(ALICE, 1, 20);
    expect(listed.total).toBe(1);
    expect(listed.items[0]!.titleKey).toBe('notifications.order.delivered.title');
    expect(listed.items[0]!.readAt).toBeNull();
    expect(listed.items[0]!.referenceId).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('stores i18n keys and render data, never a rendered sentence', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.notifyUser(notifyInput());

    const [item] = (await service.list(ALICE, 1, 20)).items;
    expect(item!.titleKey).toMatch(/^notifications\./);
    expect(item!.bodyKey).toMatch(/^notifications\./);
    expect(item!.data).toEqual({ orderId: 'order-1' });
  });

  it('counts unread, and stops counting once read', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.notifyUser(notifyInput({ dedupKey: 'a' }));
    await service.notifyUser(notifyInput({ dedupKey: 'b' }));

    expect(await service.unreadCount(ALICE)).toBe(2);

    const [first] = (await service.list(ALICE, 1, 20)).items;
    await service.markRead(ALICE, first!.id);

    expect(await service.unreadCount(ALICE)).toBe(1);
  });

  it('marking read twice is idempotent, not an error', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.notifyUser(notifyInput());
    const [item] = (await service.list(ALICE, 1, 20)).items;

    const first = await service.markRead(ALICE, item!.id);
    const second = await service.markRead(ALICE, item!.id);

    expect(first.readAt).not.toBeNull();
    expect(second.readAt).toEqual(first.readAt); // same timestamp, not re-stamped
  });

  it('paginates', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    for (let i = 0; i < 5; i += 1) {
      await service.notifyUser(notifyInput({ dedupKey: `row-${i}` }));
    }

    const page1 = await service.list(ALICE, 1, 2);
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page3 = await service.list(ALICE, 3, 2);
    expect(page3.items).toHaveLength(1);
  });
});

describe('users are isolated from each other (Bloc 7 §19, §20)', () => {
  it('Alice never sees Bob’s notifications', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.notifyUser(notifyInput({ userId: BOB, dedupKey: 'bob-1' }));

    expect((await service.list(ALICE, 1, 20)).total).toBe(0);
    expect(await service.unreadCount(ALICE)).toBe(0);
    expect((await service.list(BOB, 1, 20)).total).toBe(1);
  });

  it('Alice cannot mark Bob’s notification read — same 404 as a missing one', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.notifyUser(notifyInput({ userId: BOB, dedupKey: 'bob-1' }));
    const [bobs] = (await service.list(BOB, 1, 20)).items;

    await expect(service.markRead(ALICE, bobs!.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.markRead(ALICE, 'does-not-exist')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // And Bob's notification is untouched.
    expect(await service.unreadCount(BOB)).toBe(1);
  });

  it('the SAME business event notifies two recipients independently', async () => {
    // `dedupKey` is unique per (user, event), not globally — two people can both
    // be told about one event without one suppressing the other.
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.notifyUser(notifyInput({ userId: ALICE, dedupKey: 'shared-event' }));
    await service.notifyUser(notifyInput({ userId: BOB, dedupKey: 'shared-event' }));

    expect((await service.list(ALICE, 1, 20)).total).toBe(1);
    expect((await service.list(BOB, 1, 20)).total).toBe(1);
  });
});

describe('a redelivered event produces one notification (Bloc 7 §5, §20)', () => {
  it('the same dedupKey twice creates exactly one row', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);

    const first = await service.notifyUser(notifyInput());
    const second = await service.notifyUser(notifyInput()); // at-least-once redelivery

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect((await service.list(ALICE, 1, 20)).total).toBe(1);
  });

  it('a redelivery never re-pushes to the user’s devices', async () => {
    // The user already has it on their phone; pushing again on every worker
    // retry would be the user-visible symptom of at-least-once delivery.
    const { port, sent } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.registerDevice(ALICE, 'android', 'token-alice-phone');

    await service.notifyUser(notifyInput());
    expect(sent).toEqual(['token-alice-phone']);

    await service.notifyUser(notifyInput());
    expect(sent).toEqual(['token-alice-phone']); // still one push
  });

  it('a genuinely different event does create a second row', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.notifyUser(notifyInput({ dedupKey: 'event-1' }));
    await service.notifyUser(notifyInput({ dedupKey: 'event-2' }));
    expect((await service.list(ALICE, 1, 20)).total).toBe(2);
  });
});

describe('push is best-effort and never breaks persistence (Bloc 7 §16, §20)', () => {
  it('a throwing provider still leaves the notification recorded', async () => {
    const { port } = makePush(() => new Error('push gateway 503'));
    const service = new NotificationsService(makeDb(), port);
    await service.registerDevice(ALICE, 'ios', 'token-broken');

    const result = await service.notifyUser(notifyInput());

    expect(result.created).toBe(true); // the IN_APP channel is unaffected
    expect((await service.list(ALICE, 1, 20)).total).toBe(1);
  });

  it('one dead device does not stop delivery to the user’s other devices', async () => {
    const { port, sent } = makePush((token) =>
      token === 'token-dead'
        ? { delivered: false, shouldRevoke: true }
        : { delivered: true, shouldRevoke: false },
    );
    const service = new NotificationsService(makeDb(), port);
    await service.registerDevice(ALICE, 'ios', 'token-dead');
    await service.registerDevice(ALICE, 'android', 'token-alive');

    await service.notifyUser(notifyInput());

    expect(sent).toEqual(['token-alive']);
    // The dead token is revoked so it is not retried forever.
    const remaining = await service.listDevices(ALICE);
    expect(remaining.map((d) => d.platform)).toEqual(['android']);
  });

  it('a user with no registered device is still notified in-app', async () => {
    const { port, sent } = makePush();
    const service = new NotificationsService(makeDb(), port);

    const result = await service.notifyUser(notifyInput());

    expect(result.created).toBe(true);
    expect(sent).toEqual([]);
  });
});

describe('push devices (Bloc 7 §16, §19)', () => {
  it('supports several devices for one user', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.registerDevice(ALICE, 'android', 'token-phone');
    await service.registerDevice(ALICE, 'web', 'token-laptop');

    const listed = await service.listDevices(ALICE);
    expect(listed).toHaveLength(2);
    expect(listed.map((d) => d.platform).sort()).toEqual(['android', 'web']);
  });

  it('re-registering the same token updates it instead of duplicating', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.registerDevice(ALICE, 'android', 'token-phone');
    await service.registerDevice(ALICE, 'android', 'token-phone');

    expect(await service.listDevices(ALICE)).toHaveLength(1);
  });

  it('a token that moves to another account re-points rather than erroring', async () => {
    // A reinstall or an account switch on the same physical device. The token
    // is unique on its own precisely so this case is expressible.
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    await service.registerDevice(ALICE, 'android', 'shared-device-token');
    await service.registerDevice(BOB, 'android', 'shared-device-token');

    expect(await service.listDevices(ALICE)).toHaveLength(0);
    expect(await service.listDevices(BOB)).toHaveLength(1);
  });

  it('a revoked token stops receiving pushes', async () => {
    const { port, sent } = makePush();
    const service = new NotificationsService(makeDb(), port);
    const device = await service.registerDevice(ALICE, 'ios', 'token-to-remove');
    await service.removeDevice(ALICE, device.id);

    await service.notifyUser(notifyInput());

    expect(sent).toEqual([]);
    expect(await service.listDevices(ALICE)).toHaveLength(0);
  });

  it('Alice cannot revoke Bob’s device', async () => {
    const { port } = makePush();
    const service = new NotificationsService(makeDb(), port);
    const bobsDevice = await service.registerDevice(BOB, 'ios', 'token-bob');

    await expect(service.removeDevice(ALICE, bobsDevice.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await service.listDevices(BOB)).toHaveLength(1); // untouched
  });

  it('re-registering a revoked token brings the device back', async () => {
    const { port, sent } = makePush();
    const service = new NotificationsService(makeDb(), port);
    const device = await service.registerDevice(ALICE, 'ios', 'token-revive');
    await service.removeDevice(ALICE, device.id);
    await service.registerDevice(ALICE, 'ios', 'token-revive');

    await service.notifyUser(notifyInput());
    expect(sent).toEqual(['token-revive']);
  });
});
