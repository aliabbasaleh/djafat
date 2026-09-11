import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';

/**
 * Skeleton (Bloc 0) + guard-stack proof endpoints (Bloc 1, see
 * `admin.controller.ts`'s doc comment — NOT real features). Bloc 9: the
 * actual back-office composing the SERVICES of other modules (never their
 * repositories), audit logs, ledger view, settlements, payouts, disputes.
 */
@Module({ controllers: [AdminController] })
export class AdminModule {}
