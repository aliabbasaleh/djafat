import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { LedgerService } from './ledger.service';
import { LedgerRepository } from './ledger.repository';
import { LedgerReadService } from './ledger-read.service';
import { LedgerAdminController } from './ledger-admin.controller';
import { LEDGER_PORT } from './ledger.port';

/**
 * `LedgerModule` is global. Most callers inject `LEDGER_PORT` (the
 * `@djafat/types` interface). Same-process, DAG-allowed callers that need to
 * join an ongoing Prisma transaction (`payments`, `deliveries` — docs/18 §5)
 * inject the concrete `LedgerService` for `postEntryGroupTx`.
 * `LedgerRepository` is NOT exported — nothing outside this module can obtain it.
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LedgerAdminController],
  providers: [
    LedgerRepository,
    LedgerService,
    LedgerReadService,
    { provide: LEDGER_PORT, useExisting: LedgerService },
  ],
  exports: [LEDGER_PORT, LedgerService, LedgerReadService],
})
export class LedgerModule {}
