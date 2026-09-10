import { Module } from '@nestjs/common';

/**
 * Skeleton (Bloc 0). Bloc 7: Socket.IO gateway + Redis adapter, room auth,
 * outbox -> room fan-out, throttled courier location, polling fallback.
 * Realtime is NEVER a source of truth — every event derives from the outbox.
 */
@Module({})
export class RealtimeModule {}
