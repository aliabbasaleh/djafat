import { Global, Module } from '@nestjs/common';
import { RESTAURANT_ONBOARDING_PORT } from '../../common/ports/account-onboarding.port';
import { RestaurantOnboardingService } from './restaurant-onboarding.service';

/**
 * FEAT-022: the restaurant side of signing up, reachable by `auth` through
 * `RESTAURANT_ONBOARDING_PORT` without importing this module (module DAG).
 */
@Global()
@Module({
  providers: [
    RestaurantOnboardingService,
    { provide: RESTAURANT_ONBOARDING_PORT, useExisting: RestaurantOnboardingService },
  ],
  exports: [RestaurantOnboardingService, RESTAURANT_ONBOARDING_PORT],
})
export class RestaurantOnboardingModule {}
