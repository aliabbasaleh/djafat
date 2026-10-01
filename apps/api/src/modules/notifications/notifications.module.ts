import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DomainEventNotificationsListener } from './domain-event-notifications.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { MockPushProvider } from './providers/mock-push.provider';
import { PUSH_PROVIDER_PORT } from './push-provider.token';

/**
 * Persisted notifications (Bloc 7, docs/27 §15-16). Reactive: it listens to
 * relayed domain events and is never called synchronously by another module —
 * the shape the Bloc 0 skeleton already promised.
 *
 * Channels actually operational here:
 *   IN_APP    — a row in `notifications`; nothing external can fail.
 *   PUSH      — a `PushPort` bound to a MOCK. No real provider is configured
 *               anywhere in this repo (`apps/mobile` has no
 *               `expo-notifications`, no credentials exist), so nothing claims
 *               to deliver to a real device.
 *   SMS/EMAIL — NOT implemented. No provider, no abstraction invented for it.
 *
 * `ORDER_AMOUNT_PORT` (used to resolve an order's owner as the notification
 * recipient) comes from the GLOBAL `OrdersModule` — importing that module here
 * would itself be the boundary violation its own doc comment warns about.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    DomainEventNotificationsListener,
    { provide: PUSH_PROVIDER_PORT, useClass: MockPushProvider },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
