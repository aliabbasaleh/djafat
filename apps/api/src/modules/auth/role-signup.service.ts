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

const roleAlreadyHeld = (type: SignupDetails['type'], revoked: boolean) =>
  new ConflictException({
    code: 'ROLE_ALREADY_HELD',
    // A role the team removed leaves its rows: the app would not open — say so (SPEC-020-10 R5).
    message: revoked
      ? type === 'courier'
        ? 'Ce compte a déjà été livreur : contactez DJAFAT pour reprendre.'
        : 'Ce compte a déjà un restaurant enregistré : contactez DJAFAT.'
      : type === 'courier'
        ? 'Ce compte est déjà livreur : ouvrez l’application livreur.'
        : 'Ce compte a déjà un restaurant : ouvrez la console restaurant.',
  });

/**
 * SPEC-022-08 R5 (v4): one account, one restaurant — a member of a
 * restaurant's team never registers another (« jamais … accès restaurant A
 * ET B », migration 0028; review of FEAT-022 part 3, #4).
 */
const staffOfAnotherRestaurant = () =>
  new ConflictException({
    code: 'ROLE_ALREADY_HELD',
    message:
      "Ce compte fait partie de l'équipe d'un restaurant : inscrivez le vôtre avec un autre compte.",
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
      // R3, R5: the role — or what it left behind (a courier row, an owned restaurant).
      if (await this.users.hasRoleWithin(tx, userId, role))
        throw roleAlreadyHeld(signup.type, false);
      if (
        signup.type === 'restaurant' &&
        (await this.users.hasRoleWithin(tx, userId, 'restaurant_staff'))
      ) {
        throw staffOfAnotherRestaurant();
      }
      if (await this.registration.alreadyProvisioned(tx, userId, signup.type)) {
        throw roleAlreadyHeld(signup.type, true);
      }
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
