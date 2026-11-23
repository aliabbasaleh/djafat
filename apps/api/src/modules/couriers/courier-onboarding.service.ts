import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  CourierOnboardingPort,
  CourierSignupRecord,
} from '../../common/ports/account-onboarding.port';

/**
 * FEAT-022 (SPEC-022-02 R4): a courier who signs up exists, in the sign-up's
 * transaction, as an offline courier with an application `to_complete` — no
 * delivery until DJAFAT approves it (SPEC-022-06 R5, `CouriersService.setStatus`).
 */
@Injectable()
export class CourierOnboardingService implements CourierOnboardingPort {
  async provisionCourier(
    tx: Prisma.TransactionClient,
    userId: string,
    signup: CourierSignupRecord,
  ): Promise<void> {
    await tx.courier.create({
      data: {
        userId,
        status: 'offline',
        vehicleType: signup.vehicle,
        neighbourhoodId: signup.neighbourhoodId,
        neighbourhoodOther: signup.neighbourhoodOther,
        birthDate: new Date(`${signup.birthDate}T00:00:00.000Z`),
      },
    });
    await tx.courierApplication.create({
      data: { courierUserId: userId, termsAcceptedAt: signup.termsAcceptedAt },
    });
  }
}
