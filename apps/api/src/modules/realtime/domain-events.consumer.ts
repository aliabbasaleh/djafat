import { hostname } from 'node:os';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Redis } from 'ioredis';
import type { OutboxEnvelope } from '@djafat/types';
import { DOMAIN_EVENT_GROUP, DOMAIN_EVENT_STREAM } from '@djafat/types';
import { AppConfigService } from '../../common/config/config.service';
import { RELAYED_DOMAIN_EVENT } from '../../common/events/relayed-domain-event';

/**
 * Re-exported for convenience so realtime-local code has one import. The name
 * itself is defined in `common/events` because it is a cross-module contract
 * (see that file) — `notifications` listens for it too.
 */
export { RELAYED_DOMAIN_EVENT };

/** How long `XREADGROUP` parks waiting for new entries before looping. */
const BLOCK_MS = 5_000;
/** Entries claimed per read. */
const BATCH = 50;
/**
 * A pending entry untouched for this long is assumed to belong to a consumer
 * that died mid-handling, and is reclaimed by whoever notices first.
 */
const STALE_PENDING_MS = 60_000;

/**
 * Reads the durable domain-event stream and hands each event to the in-process
 * fan-out (Bloc 7, docs/27 §2). This is the piece that was missing: the worker
 * relayed outbox rows into Redis and **nothing consumed them**, so the durable
 * chain the architecture promises ended nowhere.
 *
 * ── Why a consumer group ──────────────────────────────────────────────────
 * Every API instance joins `realtime-fanout` under its own consumer name, so
 * Redis hands each entry to exactly one instance. That instance owns the entry
 * until it `XACK`s it. Sockets, however, live on ONE instance — so an event
 * delivered to instance A cannot reach a socket held by instance B without a
 * Socket.IO Redis adapter. That adapter IS configured since Bloc 7.1
 * (`attachSocketIoRedisAdapter` in `main.ts`, docs/28 §1) — this comment said
 * otherwise until the pilot's debt review (docs/36) caught the drift. What
 * remains unproven is only its behaviour under SEVERAL live API instances:
 * the pilot ran one (docs/36 §risques restants).
 *
 * ── What is guaranteed ────────────────────────────────────────────────────
 * At-least-once. An entry is acknowledged only after every handler resolved, so
 * a crash mid-handling leaves it pending and `XAUTOCLAIM` brings it back. The
 * cost is that handlers see duplicates, which is why the envelope carries the
 * outbox row id: consumers dedupe on it (docs/27 §5).
 *
 * ── What is NOT guaranteed ────────────────────────────────────────────────
 * Exactly-once, and ordering across aggregates. Neither is needed: realtime is
 * a diffusion mechanism, never the source of truth, and clients refetch over
 * REST after any gap (docs/27 §1, §18).
 */
@Injectable()
export class DomainEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventsConsumer.name);
  /** Blocking reads need a dedicated connection — a parked client serves nothing else. */
  private readonly redis: Redis;
  /** Unique per process, so two instances never claim the same entry. */
  private readonly consumerName = `${hostname()}-${process.pid}`;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    config: AppConfigService,
    private readonly events: EventEmitter2,
  ) {
    this.redis = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      // A blocking read must not be aborted by a retry ceiling.
      maxRetriesPerRequest: null,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
      await this.ensureGroup();
    } catch (err) {
      // Non-fatal at boot, exactly like `RedisService`: the API must still
      // serve REST, which is the authoritative surface. Realtime degrades.
      this.logger.warn(`domain-event consumer could not start: ${String(err)}`);
      return;
    }
    this.running = true;
    this.loop = this.run();
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    // `disconnect` cuts the parked blocking read immediately; `quit` would wait
    // for it to return and stall shutdown for up to BLOCK_MS.
    this.redis.disconnect();
    await this.loop?.catch(() => undefined);
  }

  /**
   * Creates the group if it does not exist. `MKSTREAM` covers a cold Redis
   * where the worker has not appended anything yet; `BUSYGROUP` means another
   * instance won the race, which is the normal case after the first boot.
   */
  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.xgroup('CREATE', DOMAIN_EVENT_STREAM, DOMAIN_EVENT_GROUP, '$', 'MKSTREAM');
      this.logger.log(`created consumer group ${DOMAIN_EVENT_GROUP} on ${DOMAIN_EVENT_STREAM}`);
    } catch (err) {
      if (!String(err).includes('BUSYGROUP')) throw err;
    }
  }

  private async run(): Promise<void> {
    // Sweep entries a previous instance read but never acknowledged before
    // taking anything new — otherwise a crash could strand events behind an
    // indefinitely growing pending list.
    await this.reclaimStale().catch((err) =>
      this.logger.warn(`initial XAUTOCLAIM failed: ${String(err)}`),
    );

    while (this.running) {
      try {
        const read = await this.redis.xreadgroup(
          'GROUP',
          DOMAIN_EVENT_GROUP,
          this.consumerName,
          'COUNT',
          BATCH,
          'BLOCK',
          BLOCK_MS,
          'STREAMS',
          DOMAIN_EVENT_STREAM,
          '>',
        );
        if (!read) continue; // BLOCK elapsed with nothing new
        for (const [, entries] of read as Array<[string, Array<[string, string[]]>]>) {
          for (const [entryId, fields] of entries) {
            await this.handleEntry(entryId, fields);
          }
        }
      } catch (err) {
        if (!this.running) return; // expected: `disconnect()` during shutdown
        this.logger.error(`domain-event read failed: ${String(err)}`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  /** Reclaims entries whose owning consumer went away mid-handling. */
  private async reclaimStale(): Promise<void> {
    const claimed = (await this.redis.xautoclaim(
      DOMAIN_EVENT_STREAM,
      DOMAIN_EVENT_GROUP,
      this.consumerName,
      STALE_PENDING_MS,
      '0-0',
      'COUNT',
      BATCH,
    )) as [string, Array<[string, string[]]>];

    const entries = claimed[1] ?? [];
    if (entries.length > 0) {
      this.logger.warn(`reclaimed ${entries.length} stale domain-event entries`);
    }
    for (const [entryId, fields] of entries) {
      await this.handleEntry(entryId, fields);
    }
  }

  /**
   * Handles one stream entry, then acknowledges it.
   *
   * Exposed (not private) so the unit tests drive the real handling path
   * without a Redis connection: the loop above is thin on purpose, and this is
   * where the decisions live.
   */
  async handleEntry(entryId: string, fields: readonly string[]): Promise<void> {
    const envelope = this.parse(fields);
    if (!envelope) {
      // A malformed entry can never succeed. Acknowledging it is the only way
      // to stop it being redelivered forever — a poison pill would otherwise
      // block the group's pending list. Logged loudly instead of hidden.
      this.logger.error(`unparseable domain-event entry ${entryId} — acknowledged and dropped`);
      await this.ack(entryId);
      return;
    }

    const startedAt = Date.now();
    try {
      // Awaited: the entry stays pending until every handler resolved, so a
      // notification write that throws is retried rather than lost.
      await this.events.emitAsync(RELAYED_DOMAIN_EVENT, envelope);
      await this.ack(entryId);
      this.logger.debug(
        `relayed ${envelope.eventType} (event ${envelope.id}) in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      // Deliberately NOT acknowledged: `XAUTOCLAIM` will bring it back.
      this.logger.error(
        `handling ${envelope.eventType} (event ${envelope.id}) failed, left pending: ${String(err)}`,
      );
    }
  }

  private async ack(entryId: string): Promise<void> {
    await this.redis.xack(DOMAIN_EVENT_STREAM, DOMAIN_EVENT_GROUP, entryId);
  }

  /** `['event', '<json>']` -> envelope, or null if the entry is not usable. */
  private parse(fields: readonly string[]): OutboxEnvelope | null {
    const index = fields.indexOf('event');
    if (index === -1 || index + 1 >= fields.length) return null;
    try {
      const parsed = JSON.parse(fields[index + 1]!) as OutboxEnvelope;
      if (typeof parsed?.id !== 'string' || typeof parsed?.eventType !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  }
}
