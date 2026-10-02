import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireAuth, RequirePermission, RequireRole } from '../auth/decorators';
import { LedgerReadService } from './ledger-read.service';

/**
 * Admin-only global financial view (Bloc 9, docs/30 §ledger-read) — the
 * `ledger:read` permission already existed (seeded Bloc 1), never exposed
 * anywhere. Read-only: this controller cannot write a single ledger row,
 * same route-prefix convention as `couriers-admin.controller.ts`/
 * `settlements.controller.ts` (each domain owns its own `admin/*` surface).
 */
@ApiTags('admin')
@Controller('admin/finance')
export class LedgerAdminController {
  constructor(private readonly ledgerRead: LedgerReadService) {}

  @Get('balances')
  @RequireAuth()
  @RequireRole('admin', 'super_admin', 'finance')
  @RequirePermission('ledger:read')
  async balances() {
    const [restaurantTotals, courierTotals, globalAccounts] = await Promise.all([
      this.ledgerRead.getOwnerBalanceTotals('restaurant'),
      this.ledgerRead.getOwnerBalanceTotals('courier'),
      this.ledgerRead.getGlobalAccountBalances(),
    ]);
    return { restaurantTotals, courierTotals, globalAccounts };
  }
}
