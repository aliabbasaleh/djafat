import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { LedgerService } from './ledger.service';
import { LedgerRepository } from './ledger.repository';
import { LEDGER_PORT } from './ledger.port';

/**
 * `LedgerModule` is global: other modules inject `LEDGER_PORT` and call
 * `postEntryGroup`. `LedgerRepository` is NOT exported — nothing outside this
 * module can obtain it.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    LedgerRepository,
    LedgerService,
    { provide: LEDGER_PORT, useExisting: LedgerService },
  ],
  exports: [LEDGER_PORT],
})
export class LedgerModule {}
