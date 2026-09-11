import { Module } from '@nestjs/common';

// Transverse (common/)
import { AppConfigModule } from './common/config/config.module';
import { LoggingModule } from './common/logging/logging.module';
import { RedisModule } from './common/redis/redis.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { HealthModule } from './common/health/health.module';
import { DomainEventsModule } from './common/events/events.module';
import { AuditModule } from './common/audit/audit.module';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';

// Infra
import { PrismaModule } from './infra/prisma/prisma.module';
import { OutboxModule } from './infra/outbox/outbox.module';
import { ObjectStorageModule } from './infra/storage/object-storage.module';

// Domain modules — DAG order (docs/05 §5.3). Skeletons at Bloc 0.
import { PlatformModule } from './modules/platform/platform.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { GeoModule } from './modules/geo/geo.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CartsModule } from './modules/carts/carts.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { CouriersModule } from './modules/couriers/couriers.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    // transverse (global)
    AppConfigModule,
    LoggingModule,
    PrismaModule,
    RedisModule,
    OutboxModule,
    ObjectStorageModule,
    IdempotencyModule,
    DomainEventsModule,
    AuditModule,
    RateLimitModule,
    HealthModule,
    // domain
    PlatformModule,
    LedgerModule,
    AuthModule,
    UsersModule,
    GeoModule,
    CatalogModule,
    PricingModule,
    CartsModule,
    OrdersModule,
    PaymentsModule,
    DeliveriesModule,
    CouriersModule,
    NotificationsModule,
    RealtimeModule,
    AdminModule,
  ],
})
export class AppModule {}
