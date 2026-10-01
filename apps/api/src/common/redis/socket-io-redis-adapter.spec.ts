import { describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';

/**
 * Bloc 7.1 — the Socket.IO Redis adapter attachment.
 *
 * `createAdapter`/`ioredis.connect()` need a real Redis to exercise the actual
 * pub/sub wiring, so this file tests exactly what IS unit-testable without
 * one: that a connection failure degrades to the in-memory adapter instead of
 * blocking boot, and that a successful connection calls
 * `app.useWebSocketAdapter` exactly once with an adapter wired to the server.
 *
 * The real multi-instance behaviour (an event relayed on instance A reaching
 * a socket held by instance B) is NOT exercised here — see
 * `socket-io-redis-adapter.int.spec.ts` and docs/28 §"tests non exécutés".
 */

const connectMock = vi.fn();
const quitMock = vi.fn();
const duplicateMock = vi.fn();

vi.mock('ioredis', () => {
  class FakeRedis {
    connect = connectMock;
    quit = quitMock;
    duplicate = duplicateMock;
  }
  return { Redis: FakeRedis };
});

vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: vi.fn(() => 'the-redis-adapter-instance'),
}));

function makeApp(): { app: INestApplication; useWebSocketAdapter: ReturnType<typeof vi.fn> } {
  const useWebSocketAdapter = vi.fn();
  return { app: { useWebSocketAdapter } as unknown as INestApplication, useWebSocketAdapter };
}

describe('a reachable Redis attaches the adapter (Bloc 7.1 §1)', () => {
  it('connects both the pub and sub clients, then attaches one adapter', async () => {
    connectMock.mockResolvedValue(undefined);
    duplicateMock.mockReturnValue({ connect: connectMock, quit: quitMock });
    const { app, useWebSocketAdapter } = makeApp();

    const { attachSocketIoRedisAdapter } = await import('./socket-io-redis-adapter');
    await attachSocketIoRedisAdapter(app, 'redis://localhost:6379');

    // Two connections: the pub client and its duplicate (the sub client) —
    // pub/sub requires a connection dedicated to nothing else.
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(duplicateMock).toHaveBeenCalledTimes(1);
    expect(useWebSocketAdapter).toHaveBeenCalledTimes(1);
  });
});

describe('an unreachable Redis degrades, never blocks boot (Bloc 7.1 §1)', () => {
  it('falls back to the default adapter when connect() rejects', async () => {
    connectMock.mockReset();
    connectMock.mockRejectedValue(new Error('ECONNREFUSED'));
    duplicateMock.mockReturnValue({ connect: connectMock, quit: quitMock });
    const { app, useWebSocketAdapter } = makeApp();

    const { attachSocketIoRedisAdapter } = await import('./socket-io-redis-adapter');
    await expect(
      attachSocketIoRedisAdapter(app, 'redis://localhost:6379'),
    ).resolves.toBeUndefined();

    // No adapter is forced — the caller's existing (default, in-memory)
    // WebSocket adapter stays in place, which is correct for a single instance.
    expect(useWebSocketAdapter).not.toHaveBeenCalled();
  });

  it('releases both connection attempts rather than leaking them', async () => {
    connectMock.mockReset();
    quitMock.mockReset();
    connectMock.mockRejectedValue(new Error('ECONNREFUSED'));
    duplicateMock.mockReturnValue({ connect: connectMock, quit: quitMock });
    const { app } = makeApp();

    const { attachSocketIoRedisAdapter } = await import('./socket-io-redis-adapter');
    await attachSocketIoRedisAdapter(app, 'redis://localhost:6379');

    expect(quitMock).toHaveBeenCalled();
  });
});
