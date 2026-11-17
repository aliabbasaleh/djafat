import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** How long shutdown waits for Prisma to disconnect (see `onModuleDestroy`). */
export const PRISMA_DISCONNECT_TIMEOUT_MS = 2_000;

/**
 * Thin wrapper over the generated Prisma client. Financial modules use raw SQL
 * (`$queryRaw` / `$executeRaw`) for double-entry writes and PostGIS; simple
 * CRUD uses the typed models.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (err) {
      this.logger.warn(
        `Prisma could not connect at boot (${(err as Error).message}). Readiness probe will report the DB as down.`,
      );
    }
  }

  /**
   * Bounded: Prisma 6.2's `$disconnect()` never settles when it is called more
   * than a moment after the process received SIGTERM (reproduced in a
   * standalone script: at once it returns, 300 ms later it hangs). Nest 11 runs
   * this hook last on shutdown, after the realtime consumer and Redis, so the
   * API kept serving after SIGTERM and never exited. Past the timeout, shutdown
   * goes on: the process exits right after and the OS closes the connections.
   */
  async onModuleDestroy(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const disconnected = await Promise.race([
      this.$disconnect().then(
        () => true,
        () => true,
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), PRISMA_DISCONNECT_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (!disconnected) {
      this.logger.warn(
        `Prisma did not disconnect within ${PRISMA_DISCONNECT_TIMEOUT_MS} ms; shutdown continues.`,
      );
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
