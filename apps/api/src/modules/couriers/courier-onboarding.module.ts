import { Global, Module } from '@nestjs/common';
import { COURIER_ONBOARDING_PORT } from '../../common/ports/account-onboarding.port';
import { COURIER_PAYOUT_ACCOUNT_PORT } from '../../common/ports/courier-payout-account.port';
import { CourierOnboardingService } from './courier-onboarding.service';
import { CourierPayoutAccountService } from './courier-payout-account.service';

/**
 * FEAT-022: the courier side of signing up, reachable by `auth` through
 * `COURIER_ONBOARDING_PORT` without importing this module (module DAG), and
 * the approved payout number, read by `payments` through
 * `COURIER_PAYOUT_ACCOUNT_PORT` (SPEC-022-07 R6).
 */
@Global()
@Module({
  providers: [
    CourierOnboardingService,
    { provide: COURIER_ONBOARDING_PORT, useExisting: CourierOnboardingService },
    CourierPayoutAccountService,
    { provide: COURIER_PAYOUT_ACCOUNT_PORT, useExisting: CourierPayoutAccountService },
  ],
  exports: [CourierOnboardingService, COURIER_ONBOARDING_PORT, COURIER_PAYOUT_ACCOUNT_PORT],
})
export class CourierOnboardingModule {}
