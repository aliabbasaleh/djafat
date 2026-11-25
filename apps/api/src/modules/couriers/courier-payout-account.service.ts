import { Injectable } from '@nestjs/common';
import type {
  CourierPayoutAccount,
  CourierPayoutAccountPort,
} from '../../common/ports/courier-payout-account.port';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * FEAT-022 (SPEC-022-07 R6, SC05): the number a courier's earnings go to —
 * the one DJAFAT approved. A new number waits in `application_changes` and is
 * never read here until an admin accepts it (`CourierApplicationService`).
 */
@Injectable()
export class CourierPayoutAccountService implements CourierPayoutAccountPort {
  constructor(private readonly prisma: PrismaService) {}

  async approvedPayoutAccounts(
    courierIds: readonly string[],
  ): Promise<Map<string, CourierPayoutAccount>> {
    if (courierIds.length === 0) return new Map();
    const rows = await this.prisma.courierApplication.findMany({
      where: { courierUserId: { in: [...courierIds] }, status: 'approved' },
      select: { courierUserId: true, mobileMoneyProvider: true, mobileMoneyNumber: true },
    });
    const accounts = new Map<string, CourierPayoutAccount>();
    for (const row of rows) {
      const provider = row.mobileMoneyProvider;
      if ((provider === 'airtel' || provider === 'moov') && row.mobileMoneyNumber) {
        accounts.set(row.courierUserId, { provider, number: row.mobileMoneyNumber });
      }
    }
    return accounts;
  }
}
