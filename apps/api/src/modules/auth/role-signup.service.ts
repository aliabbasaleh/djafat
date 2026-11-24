import { ConflictException, Injectable } from '@nestjs/common';
import type { Role } from '@djafat/types';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService, type MeDto } from '../users/users.service';
import type { RequestMeta } from './auth.service';
import type { CourierRoleSignupInput, RestaurantRoleSignupInput } from './dto/register.schema';
import { RegistrationService, type SignupDetails } from './registration.service';

const emailNotVerified = () =>
  new ConflictException({
    code: 'EMAIL_NOT_VERIFIED',
    message: "Confirmez d'abord votre adresse e-mail.",
  });

const roleAlreadyHeld = (type: SignupDetails['type']) =>
  new ConflictException({
    code: 'ROLE_ALREADY_HELD',
    message:
      type === 'courier'
        ? 'Ce compte est déjà livreur : ouvrez l’application livreur.'
        : 'Ce compte a déjà un restaurant : ouvrez la console restaurant.',
  });

/**
 * « Devenir livreur » and « Inscrire mon restaurant » from « Mon profil »
 * (FEAT-022, SPEC-022-08): the signed-in account gets the role and its
 * application, with the sign-up's rules (age, neighbourhood, terms) and its
 * ports — never a second account. The session is the proof of identity, but
 * the e-mail must be verified (R2): DJAFAT's decision reaches the person there.
 */
@Injectable()
export class RoleSignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly registration: RegistrationService,
    private readonly audit: AuditService,
  ) {}

  becomeCourier(userId: string, input: CourierRoleSignupInput, meta: RequestMeta): Promise<MeDto> {
    return this.add(
      userId,
      {
        type: 'courier',
        vehicle: input.vehicle,
        birthDate: input.birthDate,
        neighbourhoodId: input.neighbourhoodId ?? null,
        neighbourhoodOther: input.neighbourhoodOther ?? null,
      },
      meta,
    );
  }

  registerRestaurant(
    userId: string,
    input: RestaurantRoleSignupInput,
    meta: RequestMeta,
  ): Promise<MeDto> {
    return this.add(
      userId,
      {
        type: 'restaurant',
        restaurantName: input.restaurantName,
        neighbourhoodId: input.neighbourhoodId ?? null,
        neighbourhoodOther: input.neighbourhoodOther ?? null,
      },
      meta,
    );
  }

  private async add(userId: string, signup: SignupDetails, meta: RequestMeta): Promise<MeDto> {
    const user = await this.users.getByIdOrThrow(userId);
    if (!user.email || !user.emailVerifiedAt) throw emailNotVerified(); // R2
    await this.registration.checkSignup(signup); // age (422 UNDERAGE), neighbourhood

    const role = signup.type === 'courier' ? 'courier' : 'restaurant_owner';
    await this.prisma.$transaction(async (tx) => {
      // Two clicks, two tabs: one at a time per account, then the role is read again.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role-signup:${userId}`}))`;
      if (await this.users.hasRoleWithin(tx, userId, role)) throw roleAlreadyHeld(signup.type); // R3, R5
      await this.registration.provisionSignup(tx, userId, {
        ...signup,
        termsAcceptedAt: new Date().toISOString(),
      });
    });

    await this.audit.log({
      actorUserId: userId,
      action: 'ROLE_SELF_SIGNUP',
      entityType: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { accountType: signup.type },
    });
    // FEAT-022-Q13: the same welcome as a sign-up (SPEC-022-08 R2).
    this.registration.sendWelcome(user.email, signup);
    const roles: Role[] = await this.users.getRoles(userId);
    return this.users.toMeDto(user, roles);
  }
}
