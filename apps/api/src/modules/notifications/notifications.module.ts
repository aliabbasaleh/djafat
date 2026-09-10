import { Module } from '@nestjs/common';

/**
 * Skeleton (Bloc 0). Bloc 7: event -> channel (push / in-app / SMS / email)
 * per preferences + criticality, i18n templates, dedup. Reactive — listens to
 * the outbox, is not called synchronously by anyone.
 */
@Module({})
export class NotificationsModule {}
