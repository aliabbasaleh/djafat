import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { IdempotencyService } from './idempotency.service';
import { PrismaIdempotencyStore } from './prisma-idempotency.store';
import { IDEMPOTENCY_STORE } from './idempotency.types';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [IdempotencyService, { provide: IDEMPOTENCY_STORE, useClass: PrismaIdempotencyStore }],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
