import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { DomainEventType, PushPort } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PUSH_PROVIDER_PORT } from './push-provider.token';

export interface NotificationDto {
  readonly id: string;
  readonly type: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  readonly data: Record<string, unknown>;
  readonly referenceAggregate: string | null;
  readonly referenceId: string | null;
  readonly createdAt: string;
  readonly readAt: string | null;
}

export interface PaginatedNotifications {
  readonly items: readonly NotificationDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface DeviceDto {
  readonly id: string;
  readonly platform: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
}

export interface NotifyUserInput {
  readonly userId: string;
  readonly type: DomainEventType;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** Small, non-sensitive render data only (docs/27 §11, §15) — never a full aggregate. */
  readonly data?: Record<string, string>;
  readonly referenceAggregate?: string;
  readonly referenceId?: string;
  /** The producing outbox row's id — the idempotency key (docs/27 §5, §13). */
  readonly dedupKey: string;
}

/**
 * Persisted, cross-device notifications (Bloc 7, docs/27 §15). The one
 * channel that is unconditionally "operational": a row in this table IS the
 * IN_APP notification — no external provider, nothing that can be
 * misconfigured. PUSH is attempted best-effort on top of it through
 * `PushPort`, currently bound to a mock (docs/27 §16) because no real
 * provider is configured anywhere in this repository.
 *
 * Never the source of truth for anything business-facing: a lost or delayed
 * notification never changes an order's state, only whether the user was
 * told about it promptly (docs/27 §1).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER_PORT) private readonly push: PushPort,
  ) {}

  /**
   * Creates the notification row idempotently — `ON CONFLICT (user_id,
   * dedup_key) DO NOTHING` is what makes a redelivered domain event (the
   * transport's at-least-once guarantee, docs/27 §5) produce at most ONE row
   * per recipient rather than a duplicate on every retry.
   *
   * Then best-effort pushes to every active device. A push failure is logged
   * and never thrown: the notification is already durably recorded, and an
   * unreachable push provider must not make the CALLER (the domain-event
   * consumer, which only acks after this resolves) retry the whole event
   * forever over an IN_APP row that already exists.
   */
  async notifyUser(input: NotifyUserInput): Promise<{ created: boolean; id: string }> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO notifications (user_id, type, title_key, body_key, data, reference_aggregate, reference_id, dedup_key)
      VALUES (
        ${input.userId}::uuid, ${input.type}, ${input.titleKey}, ${input.bodyKey},
        ${JSON.stringify(input.data ?? {})}::jsonb,
        ${input.referenceAggregate ?? null}, ${input.referenceId ?? null}::uuid,
        ${input.dedupKey}
      )
      ON CONFLICT (user_id, dedup_key) DO NOTHING
      RETURNING id
    `;
    const row = rows[0];
    if (!row) {
      // Already recorded for this recipient — a replay of the same event.
      // Never re-push: the user already has the notification on their device.
      return { created: false, id: '' };
    }

    await this.pushToDevices(input).catch((err) => {
      this.logger.warn(`push fan-out failed for notification ${row.id}: ${String(err)}`);
    });

    return { created: true, id: row.id };
  }

  private async pushToDevices(input: NotifyUserInput): Promise<void> {
    const devices = await this.prisma.notificationDevice.findMany({
      where: { userId: input.userId, revokedAt: null },
    });
    for (const device of devices) {
      const result = await this.push
        .send({
          token: device.pushToken,
          platform: device.platform as 'ios' | 'android' | 'web',
          titleKey: input.titleKey,
          bodyKey: input.bodyKey,
          data: input.data ?? {},
        })
        .catch(() => ({ delivered: false, shouldRevoke: false }));

      if (result.shouldRevoke) {
        // The provider says this token is dead (uninstalled app, expired
        // registration) — stop trying it, without touching the user's other
        // devices.
        await this.prisma.notificationDevice.update({
          where: { id: device.id },
          data: { revokedAt: new Date() },
        });
      } else if (result.delivered) {
        await this.prisma.notificationDevice.update({
          where: { id: device.id },
          data: { lastSeenAt: new Date() },
        });
      }
    }
  }

  async list(userId: string, page: number, limit: number): Promise<PaginatedNotifications> {
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: { userId } }),
    ]);
    return {
      items: items.map((n) => this.toDto(n)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  /**
   * Marks one notification read. Same 404-for-both discipline as every other
   * ownership check in this codebase (docs/25 §46 IDOR): a notification that
   * does not exist and one that belongs to someone else are indistinguishable
   * from the caller's side. Idempotent — marking an already-read notification
   * read again is a harmless no-op, not an error.
   */
  async markRead(userId: string, notificationId: string): Promise<NotificationDto> {
    const updated = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (updated.count === 0) {
      const existing = await this.prisma.notification.findFirst({
        where: { id: notificationId, userId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Notification not found.',
        });
      }
      return this.toDto(existing); // already read — idempotent replay
    }
    const fresh = await this.prisma.notification.findUniqueOrThrow({
      where: { id: notificationId },
    });
    return this.toDto(fresh);
  }

  /** For `@RequireOwnership` on the mark-read route. */
  async getOwnerUserId(notificationId: string): Promise<string> {
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: { userId: true },
    });
    if (!row) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Notification not found.' });
    }
    return row.userId;
  }

  /**
   * Registers a device for push (docs/27 §16). Upserts on the token, not on
   * (user, token): a token identifies one physical installation, and a
   * reinstall or an account switch on the same device legitimately re-points
   * it to a different user rather than creating a duplicate row forever
   * associated with whoever installed the app first.
   */
  async registerDevice(
    userId: string,
    platform: 'ios' | 'android' | 'web',
    pushToken: string,
  ): Promise<DeviceDto> {
    const row = await this.prisma.notificationDevice.upsert({
      where: { pushToken },
      create: { userId, platform, pushToken },
      update: { userId, platform, lastSeenAt: new Date(), revokedAt: null },
    });
    return {
      id: row.id,
      platform: row.platform,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    };
  }

  async listDevices(userId: string): Promise<DeviceDto[]> {
    const rows = await this.prisma.notificationDevice.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      platform: row.platform,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    }));
  }

  /** Ownership-checked removal — never lets a user revoke someone else's device. */
  async removeDevice(userId: string, deviceId: string): Promise<void> {
    const result = await this.prisma.notificationDevice.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0) {
      // Either it does not exist, belongs to someone else, or is already
      // revoked — all three answer the same way (idempotent on the last one).
      const existing = await this.prisma.notificationDevice.findFirst({
        where: { id: deviceId, userId },
      });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Device not found.' });
      }
    }
  }

  private toDto(n: {
    id: string;
    type: string;
    titleKey: string;
    bodyKey: string;
    data: unknown;
    referenceAggregate: string | null;
    referenceId: string | null;
    createdAt: Date;
    readAt: Date | null;
  }): NotificationDto {
    return {
      id: n.id,
      type: n.type,
      titleKey: n.titleKey,
      bodyKey: n.bodyKey,
      data: (n.data ?? {}) as Record<string, unknown>,
      referenceAggregate: n.referenceAggregate,
      referenceId: n.referenceId,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    };
  }
}
