import { Global, Module } from '@nestjs/common';
import { COURIER_ONBOARDING_PORT } from '../../common/ports/account-onboarding.port';
import { CourierOnboardingService } from './courier-onboarding.service';

/**
 * FEAT-022: the courier side of signing up, reachable by `auth` through
 * `COURIER_ONBOARDING_PORT` without importing this module (module DAG).
 */
@Global()
@Module({
  providers: [
    CourierOnboardingService,
    { provide: COURIER_ONBOARDING_PORT, useExisting: CourierOnboardingService },
  ],
  exports: [CourierOnboardingService, COURIER_ONBOARDING_PORT],
})
export class CourierOnboardingModule {}
