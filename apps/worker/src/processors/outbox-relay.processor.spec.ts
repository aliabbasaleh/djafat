import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutboxEnvelope } from '@djafat/types';

/**
 * Bloc 7 §20 — the relay's own delivery guarantees, unit-tested against a fake
 * that mirrors real PostgreSQL transaction semantics: the whole batch runs in
 * ONE transaction (`withTransaction` wraps the entire loop, exactly like the
 * real `outboxRelayProcessor`), and once a query throws, the transaction is
 * aborted and everything in it — including rows the loop already marked
 * `published` earlier in the same tick — is rolled back. That single detail is
 * what makes "crash after publish" a real, provable scenario rather than an
 * assumption.
 *
 * Same harness discipline as `order-expiry.processor.spec.ts` and
 * `dispatch.processor.spec.ts`: fake ONLY the connection layer, run the REAL
 * `outboxRelayProcessor` SQL text and control flow.
 */

vi.mock('../db', () => ({
  withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const snapshot = rows.map((r) => ({ ...r }));
    const client = makeClient(snapshot);
    const result = await fn(client);
    // Commit. Rollback needs no branch: if `fn` throws, this line never runs
    // and `rows` — the committed view — keeps its pre-transaction contents,
    // exactly as a real ROLLBACK leaves the table.
    rows = snapshot;
    return result;
  },
}));
vi.mock('../logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface Row {
  id: string;
  aggregate: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  status: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: Date;
  created_at: Date;
  processed_at: Date | null;
}

let rows: Row[] = [];
/** Query text substrings that should throw once, simulating a crash mid-transaction. */
let failQueriesContaining: string[] = [];

function makeClient(snapshot: Row[]) {
  let aborted = false;
  return {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      if (aborted) {
        // Real PostgreSQL: once one statement in a transaction errors, every
        // subsequent statement on that connection fails until ROLLBACK
        // (`25P02 current transaction is aborted`) — the relay's catch block
        // cannot "recover" by writing an error message after that point.
        throw new Error(
          'current transaction is aborted, commands ignored until end of transaction block',
        );
      }
      if (failQueriesContaining.some((needle) => text.includes(needle))) {
        aborted = true;
        throw new Error('simulated crash');
      }

      if (
        text.includes(
          'SELECT id, aggregate, aggregate_id, event_type, payload, attempts, created_at',
        )
      ) {
        const now = Date.now();
        const [limit] = params as [number];
        const eligible = snapshot
          .filter(
            (r) => ['pending', 'failed'].includes(r.status) && r.next_attempt_at.getTime() <= now,
          )
          .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
          .slice(0, limit);
        return { rows: eligible.map((r) => ({ ...r })) };
      }
      if (text.includes("SET status = 'published'")) {
        const [id] = params as [string];
        const row = snapshot.find((r) => r.id === id);
        if (row) {
          row.status = 'published';
          row.processed_at = new Date();
        }
        return { rows: [] };
      }
      if (text.includes('SET attempts = $2')) {
        const [id, attempts, lastError, status, backoffSeconds] = params as [
          string,
          number,
          string,
          string,
          number,
        ];
        const row = snapshot.find((r) => r.id === id);
        if (row) {
          row.attempts = attempts;
          row.last_error = lastError;
          row.status = status;
          row.next_attempt_at = new Date(Date.now() + backoffSeconds * 1000);
        }
        return { rows: [] };
      }
      throw new Error(`Unhandled query in fake client: ${text}`);
    }),
  };
}

function seedRow(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: randomUUID(),
    aggregate: 'order',
    aggregate_id: randomUUID(),
    event_type: 'order.ready',
    payload: { orderId: 'order-1' },
    status: 'pending',
    attempts: 0,
    last_error: null,
    next_attempt_at: new Date(Date.now() - 1000),
    created_at: new Date(Date.now() - 2000),
    processed_at: null,
    ...overrides,
  };
  rows.push(row);
  return row;
}

/**
 * `withTransaction`'s fake commits by reassigning `rows` to a NEW array of
 * CLONED row objects (mirroring a real transaction snapshot) — so a `row`
 * reference taken before a successful `runRelay` call is stale afterwards.
 * Tests read current state through this instead of the original reference.
 */
function get(id: string): Row {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`row ${id} not found after transaction`);
  return row;
}

beforeEach(() => {
  rows = [];
  failQueriesContaining = [];
});

async function runRelay(publish: (e: OutboxEnvelope) => Promise<string>) {
  const { outboxRelayProcessor } = await import('./outbox-relay.processor');
  return outboxRelayProcessor(publish);
}

describe('a healthy relay publishes and marks rows published (mandate §20)', () => {
  it('publishes an eligible row and marks it published', async () => {
    const row = seedRow();
    const published: OutboxEnvelope[] = [];
    const result = await runRelay(async (e) => {
      published.push(e);
      return '1-0';
    });

    expect(result).toEqual({ published: 1, failed: 0 });
    expect(published).toHaveLength(1);
    expect(published[0]!.id).toBe(row.id);
    expect(published[0]!.eventType).toBe('order.ready');
    expect(get(row.id).status).toBe('published');
    expect(get(row.id).processed_at).not.toBeNull();
  });

  it('carries the business commit time, not the relay time', async () => {
    const committedAt = new Date('2026-01-01T00:00:00.000Z');
    seedRow({ created_at: committedAt });
    let seen: OutboxEnvelope | undefined;
    await runRelay(async (e) => {
      seen = e;
      return '1-0';
    });
    expect(seen!.createdAt).toBe(committedAt.toISOString());
  });

  it('a row not yet due (next_attempt_at in the future) is left alone', async () => {
    const row = seedRow({ next_attempt_at: new Date(Date.now() + 60_000) });
    const result = await runRelay(async () => '1-0');
    expect(result).toEqual({ published: 0, failed: 0 });
    expect(get(row.id).status).toBe('pending');
  });

  it('an already-published row is never republished', async () => {
    seedRow({ status: 'published', processed_at: new Date() });
    let calls = 0;
    const result = await runRelay(async () => {
      calls += 1;
      return '1-0';
    });
    expect(calls).toBe(0);
    expect(result).toEqual({ published: 0, failed: 0 });
  });
});

describe('the gateway/transport being unavailable (mandate §12, §20)', () => {
  it('a publish rejection leaves the row pending with attempts incremented', async () => {
    const row = seedRow();
    const result = await runRelay(async () => {
      throw new Error('redis unreachable');
    });

    expect(result).toEqual({ published: 0, failed: 1 });
    const after = get(row.id);
    expect(after.status).toBe('pending'); // below MAX_ATTEMPTS
    expect(after.attempts).toBe(1);
    expect(after.last_error).toMatch(/redis unreachable/);
    expect(after.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  });

  it('backoff grows exponentially across repeated failures', async () => {
    const row = seedRow();
    const delays: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      get(row.id).next_attempt_at = new Date(Date.now() - 1000); // force eligible again
      const before = Date.now();
      await runRelay(async () => {
        throw new Error('still down');
      });
      delays.push(get(row.id).next_attempt_at.getTime() - before);
    }
    // 2^1, 2^2, 2^3 seconds — each strictly larger than the last.
    expect(delays[1]).toBeGreaterThan(delays[0]!);
    expect(delays[2]).toBeGreaterThan(delays[1]!);
  });

  it('exceeding MAX_ATTEMPTS moves the row to the DLQ status', async () => {
    const row = seedRow({ attempts: 9 }); // one more failure crosses MAX_ATTEMPTS=10
    await runRelay(async () => {
      throw new Error('permanently down');
    });
    expect(get(row.id).status).toBe('failed'); // the DLQ status
    expect(get(row.id).attempts).toBe(10);
  });

  it('a DLQ row is still picked up by the query (status IN pending, failed) — retried, not abandoned', async () => {
    // `failed` here means "exhausted automatic retries", not "never tried
    // again" — the SELECT's WHERE clause deliberately includes it. Backoff has
    // already capped at 300s, so it is tried again, just slowly.
    const row = seedRow({
      status: 'failed',
      attempts: 12,
      next_attempt_at: new Date(Date.now() - 1),
    });
    const result = await runRelay(async (e) => {
      expect(e.id).toBe(row.id);
      return '1-0';
    });
    expect(result.published).toBe(1);
    expect(get(row.id).status).toBe('published');
  });
});

describe('a crash mid-batch rolls back the whole transaction (mandate §20)', () => {
  it('crash BEFORE any publish: nothing is marked, nothing was sent', async () => {
    const row = seedRow();
    failQueriesContaining = ['SELECT id, aggregate'];

    const published: string[] = [];
    await expect(
      runRelay(async (e) => {
        published.push(e.id);
        return '1-0';
      }),
    ).rejects.toThrow('simulated crash');

    expect(published).toEqual([]);
    expect(row.status).toBe('pending'); // untouched — the SELECT itself never committed
  });

  // The scenario the mandate specifically asks for: the event reaches the
  // durable transport (the stream append resolves), but the transaction that
  // was going to record that fact never commits. This is exactly why at-least-
  // once, not exactly-once, is the contract downstream consumers must accept
  // (docs/27 §5): the SAME row is published again on the next tick.
  it('crash AFTER publish resolves but before the row is marked: republished next tick', async () => {
    const row = seedRow();
    failQueriesContaining = ["SET status = 'published'"];

    const firstTickPublishes: string[] = [];
    await expect(
      runRelay(async (e) => {
        firstTickPublishes.push(e.id);
        return '1-0'; // the append itself succeeded — this is not rolled back
      }),
    ).rejects.toThrow(/aborted|simulated crash/);

    expect(firstTickPublishes).toEqual([row.id]); // publish WAS called
    expect(row.status).toBe('pending'); // but the DB never recorded it

    // Next tick: the row is still eligible and gets published again.
    failQueriesContaining = [];
    const secondTickPublishes: string[] = [];
    const result = await runRelay(async (e) => {
      secondTickPublishes.push(e.id);
      return '2-0';
    });

    expect(result.published).toBe(1);
    expect(secondTickPublishes).toEqual([row.id]);
    expect(get(row.id).status).toBe('published');
    // The transport received this event TWICE — proving why the envelope
    // carries the outbox row id and consumers must dedupe on it, never assume
    // exactly-once (docs/27 §5, §13).
    expect([...firstTickPublishes, ...secondTickPublishes]).toEqual([row.id, row.id]);
  });

  it('one row failing mid-batch does not roll back an EARLIER row’s publish within the same tick', async () => {
    // Two separate rows are two separate loop iterations INSIDE one
    // transaction. The first row's UPDATE already executed successfully before
    // the second row's publish throws — only the second row's own write is
    // affected by its own catch block, not the first row's completed write.
    const first = seedRow({ created_at: new Date(Date.now() - 3000) });
    const second = seedRow({ created_at: new Date(Date.now() - 2000) });

    const result = await runRelay(async (e) => {
      if (e.id === second.id) throw new Error('publish failed for second row');
      return '1-0';
    });

    expect(result).toEqual({ published: 1, failed: 1 });
    expect(get(first.id).status).toBe('published');
    expect(get(second.id).status).toBe('pending');
    expect(get(second.id).attempts).toBe(1);
  });
});

describe('duplicate publication is tolerated, never assumed impossible (mandate §5, §20)', () => {
  it('publishing the exact same envelope twice across two ticks is not rejected by the relay', async () => {
    const row = seedRow();
    await runRelay(async () => '1-0');
    expect(get(row.id).status).toBe('published');

    // Simulate an operator or a retry mechanism re-queuing the same row.
    get(row.id).status = 'pending';
    get(row.id).next_attempt_at = new Date(Date.now() - 1000);
    const secondPublishes: string[] = [];
    const result = await runRelay(async (e) => {
      secondPublishes.push(e.id);
      return '2-0';
    });

    expect(result.published).toBe(1);
    expect(secondPublishes).toEqual([row.id]);
    // The relay does not deduplicate — that is deliberately the CONSUMER's job
    // (the outbox row id is the dedup key), never the relay's.
  });
});

describe('worker restart (mandate §12, §20)', () => {
  it('a tick after a restart picks up rows left pending by the previous process', async () => {
    // Nothing process-local (no in-memory queue) survives a restart in this
    // design — eligibility is entirely DB-derived (`status`, `next_attempt_at`),
    // which is what makes "restart" indistinguishable from "next tick" here.
    seedRow({ status: 'pending' });
    seedRow({ status: 'failed', attempts: 3, next_attempt_at: new Date(Date.now() - 1) });

    const result = await runRelay(async () => '1-0');
    expect(result.published).toBe(2);
  });
});
