import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { LedgerService } from './ledger.service';
import { LedgerRepository } from './ledger.repository';
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
  providers: [
    LedgerRepository,
    LedgerService,
    { provide: LEDGER_PORT, useExisting: LedgerService },
  ],
  exports: [LEDGER_PORT, LedgerService],
})
export class LedgerModule {}
