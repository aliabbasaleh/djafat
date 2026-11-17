import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRISMA_DISCONNECT_TIMEOUT_MS, PrismaService } from './prisma.service';

/**
 * Shutdown must not wait forever on Prisma. Prisma 6.2's `$disconnect()` never
 * settles when it is called more than a moment after the process received
 * SIGTERM (reproduced in a standalone script). Nest 11 runs this hook last on
 * shutdown, after the realtime consumer and Redis, so the API stopped answering
 * SIGTERM: the HTTP server was never closed and the process never exited.
 */
describe('PrismaService.onModuleDestroy', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('disconnects normally when Prisma answers', async () => {
    const prisma = new PrismaService();
    const disconnect = vi.spyOn(prisma, '$disconnect').mockResolvedValue(undefined);
    await expect(prisma.onModuleDestroy()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('gives up after the timeout when $disconnect() never settles, so shutdown goes on', async () => {
    vi.useFakeTimers();
    const prisma = new PrismaService();
    vi.spyOn(prisma, '$disconnect').mockReturnValue(new Promise<void>(() => undefined));
    let settled = false;
    const done = prisma.onModuleDestroy().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(PRISMA_DISCONNECT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(settled).toBe(true);
  });

  it('a failing $disconnect() does not fail shutdown', async () => {
    const prisma = new PrismaService();
    vi.spyOn(prisma, '$disconnect').mockRejectedValue(new Error('engine gone'));
    await expect(prisma.onModuleDestroy()).resolves.toBeUndefined();
  });
});
