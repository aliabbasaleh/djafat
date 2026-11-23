import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import {
  COURIER_SIGNUP_MESSAGES,
  COURIER_VEHICLES,
  checkCourierBirthDate,
  ndjamenaDate,
  type CourierVehicle,
} from '@djafat/core';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { UsersService } from '../users/users.service';
import { NeighbourhoodsService } from '../geo/neighbourhoods.service';
import {
  COURIER_ONBOARDING_PORT,
  RESTAURANT_ONBOARDING_PORT,
  type CourierOnboardingPort,
  type RestaurantOnboardingPort,
} from '../../common/ports/account-onboarding.port';
import { ACCOUNT_NOTICE_PORT, type AccountNoticePort } from './account-notice.port';
import { AuthService, type LoginResultDto, type RequestMeta } from './auth.service';
import { emailDeliveryFailed, emailUnavailable } from './email-delivery-errors';
import { OtpService } from './otp.service';
import { hashPassword } from './password-hash.util';
import { TrustedDeviceService } from './trusted-device.service';

/** A pending registration lives 30 minutes; each of its codes, `otp_ttl_seconds`. */
const REGISTRATION_TTL_MS = 30 * 60 * 1000;

/** FEAT-022: what a courier or a restaurant adds to the account (SPEC-022-02 R1, SPEC-022-03 R1). */
export type SignupDetails =
  | {
      readonly type: 'courier';
      readonly vehicle: CourierVehicle;
      readonly neighbourhoodId: string | null;
      readonly neighbourhoodOther: string | null;
      /** `YYYY-MM-DD`; 18 years or more (R2, checked here). */
      readonly birthDate: string;
    }
  | {
      readonly type: 'restaurant';
      readonly restaurantName: string;
      readonly neighbourhoodId: string | null;
      readonly neighbourhoodOther: string | null;
    };

export interface RegistrationInput {
  readonly fullName: string;
  /** E.164, normalised by the schema (FEAT-005). */
  readonly phone: string;
  /** Lower-cased by the schema (FEAT-007). */
  readonly email: string;
  readonly password: string;
  /** Absent: a customer (FEAT-020). */
  readonly signup?: SignupDetails;
}

/** A login result plus the token of the device just remembered (SPEC-020-04 R9). */
export interface SignedInWithDeviceDto extends LoginResultDto {
  readonly deviceToken?: string;
  readonly deviceTokenExpiresAt?: string;
}

/** What `auth_challenges.payload` holds for a registration — a hash, never a password. */
const NeighbourhoodPayload = {
  neighbourhoodId: z.string().nullable(),
  neighbourhoodOther: z.string().nullable(),
  /** When the terms box was ticked: at the request (FEAT-022-Q05). */
  termsAcceptedAt: z.string(),
};
const RegistrationPayload = z.object({
  fullName: z.string(),
  phone: z.string(),
  passwordHash: z.string(),
  /** FEAT-022: absent for a customer. */
  signup: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('courier'),
        vehicle: z.enum(COURIER_VEHICLES),
        birthDate: z.string(),
        ...NeighbourhoodPayload,
      }),
      z.object({
        type: z.literal('restaurant'),
        restaurantName: z.string(),
        ...NeighbourhoodPayload,
      }),
    ])
    .optional(),
});
type SignupPayload = NonNullable<z.infer<typeof RegistrationPayload>['signup']>;

const otpInvalid = () =>
  new UnauthorizedException({ code: 'OTP_INVALID', message: 'Invalid or expired code.' });

/** What a used address's pending registration holds: nothing that could create an account (R13). */
const DECOY_PAYLOAD = { decoy: true } as const;

function isDecoy(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'decoy' in payload;
}

/**
 * Create an account with a name, a phone, an email and a password, confirmed
 * by a code sent to the email (FEAT-020, SPEC-020-03). Nothing is written to
 * `users` before the right code: until then the registration waits in
 * `auth_challenges`, and its code is bound to it (`context`), so two pending
 * registrations for one address can never complete each other.
 */
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly auth: AuthService,
    private readonly devices: TrustedDeviceService,
    @Inject(ACCOUNT_NOTICE_PORT) private readonly notices: AccountNoticePort,
    private readonly audit: AuditService,
    @Inject(COURIER_ONBOARDING_PORT) private readonly courierOnboarding: CourierOnboardingPort,
    @Inject(RESTAURANT_ONBOARDING_PORT)
    private readonly restaurantOnboarding: RestaurantOnboardingPort,
    private readonly neighbourhoods: NeighbourhoodsService,
  ) {}

  async request(
    input: RegistrationInput,
    ip: string | null,
  ): Promise<{ registrationId: string; expiresAt: string }> {
    // R10: charged first, so even a 409 costs from the network's budget.
    if (ip) await this.otp.consumeIpBudget(ip);
    // FEAT-022: the courier's age and the neighbourhood, before anything is stored.
    await this.checkSignup(input.signup);

    // R2 (FEAT-020-Q06): one account per number, said openly.
    if (await this.users.findByPhone(input.phone)) {
      throw new ConflictException({
        code: 'PHONE_ALREADY_USED',
        message:
          "Ce numéro a déjà un compte. Connectez-vous avec ce numéro ou avec l'e-mail de ce compte.",
      });
    }

    await this.purgeExpired();
    const expiresAt = new Date(Date.now() + REGISTRATION_TTL_MS);
    const target = { channel: 'email' as const, target: input.email };

    // R3, R13 (FEAT-020-Q16, review #3): an address already used gets a notice
    // instead of a code, and nothing tells it from a free one — not the answer,
    // not a lock (checked first for both), not the time (both hash and store a
    // pending registration), not what follows (`resend` and `verify` take the
    // same path on the decoy row, which has no code and can never complete).
    await this.otp.assertNotLocked(input.email);
    const passwordHash = await hashPassword(input.password);
    const taken = (await this.users.findByEmail(input.email)) !== null;
    const row = await this.prisma.authChallenge.create({
      data: {
        kind: 'registration',
        email: input.email,
        payload: taken
          ? DECOY_PAYLOAD
          : {
              fullName: input.fullName,
              phone: input.phone,
              passwordHash,
              ...(input.signup
                ? { signup: { ...input.signup, termsAcceptedAt: new Date().toISOString() } }
                : {}),
            },
        expiresAt,
      },
      select: { id: true },
    });
    if (taken) await this.sendAlreadyRegistered(target);
    else await this.otp.requestCode(target, 'register', ip, { context: row.id, ipCharged: true });
    return { registrationId: row.id, expiresAt: expiresAt.toISOString() };
  }

  async verify(
    registrationId: string,
    code: string,
    meta: RequestMeta,
  ): Promise<SignedInWithDeviceDto> {
    const row = await this.pending(registrationId);
    if (!row) throw otpInvalid(); // R6: unknown, expired, consumed — one answer

    await this.otp.verifyCode({ channel: 'email', target: row.email }, code, 'register', meta.ip, {
      context: row.id,
    }); // throws OTP_INVALID / OTP_LOCKED — a decoy has no code, so it always stops here
    if (isDecoy(row.payload)) throw otpInvalid();

    const { signup, ...account } = RegistrationPayload.parse(row.payload);
    // R5, R8 (review #7): the account, its role and the consumed registration
    // in ONE transaction; a number or address taken meanwhile -> 409. FEAT-022:
    // the courier or restaurant and its role join the same transaction.
    const { userId } = await this.users.createRegisteredCustomer(
      { ...account, email: row.email },
      async (tx) => {
        const claimed = await tx.authChallenge.updateMany({
          where: { id: row.id, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        if (claimed.count !== 1) throw otpInvalid();
      },
      signup ? (tx, createdId) => this.provision(tx, createdId, signup) : undefined,
    );
    await this.audit.log({
      actorUserId: userId,
      action: 'AUTH_REGISTERED',
      entityType: 'user',
      entityId: userId,
      ip: meta.ip,
      userAgent: meta.userAgent,
      metadata: { accountType: signup?.type ?? 'customer' },
    });

    const session = await this.auth.openSession(userId, meta);
    // The code proved the mailbox on this device: it is remembered (FEAT-020-VIS03).
    const device = await this.devices.trust(userId, meta);
    return {
      ...session,
      deviceToken: device.token,
      deviceTokenExpiresAt: device.expiresAt.toISOString(),
    };
  }

  /** R9: a new code for the same registration; only the latest is valid. Unknown -> nothing. */
  async resend(registrationId: string, ip: string | null): Promise<void> {
    const row = await this.pending(registrationId);
    if (!row) return;
    const target = { channel: 'email' as const, target: row.email };
    if (isDecoy(row.payload)) {
      // R13: the same budgets, lock and outcome as the code below.
      if (ip) await this.otp.consumeIpBudget(ip);
      await this.sendAlreadyRegistered(target);
      return;
    }
    await this.otp.requestCode(target, 'register', ip, { context: row.id });
  }

  /** R3, R13: the decoy's "send" — same budget and lock as a code, same 503 when it cannot leave. */
  private async sendAlreadyRegistered(target: { channel: 'email'; target: string }): Promise<void> {
    await this.otp.consumeTargetBudget(target);
    await this.otp.assertNotLocked(target.target);
    const outcome = await this.notices.send({ kind: 'already_registered', to: target.target });
    if (outcome === 'failed') throw emailDeliveryFailed();
    if (outcome === 'unavailable') throw emailUnavailable();
  }

  /**
   * FEAT-022: SPEC-022-02 R2 — a courier is 18 or older on N'Djamena's date
   * (422 `UNDERAGE`); SPEC-022-09 — a neighbourhood id names an active one
   * (422 `NEIGHBOURHOOD_UNKNOWN`). Nothing here depends on whether an account exists.
   */
  private async checkSignup(signup: SignupDetails | undefined): Promise<void> {
    if (!signup) return;
    if (signup.type === 'courier') {
      const verdict = checkCourierBirthDate(signup.birthDate, ndjamenaDate(new Date()));
      if (!verdict.ok) {
        throw new UnprocessableEntityException({
          code: verdict.reason === 'underage' ? 'UNDERAGE' : 'VALIDATION_ERROR',
          message: COURIER_SIGNUP_MESSAGES[verdict.reason],
        });
      }
    }
    if (signup.neighbourhoodId && !(await this.neighbourhoods.findActive(signup.neighbourhoodId))) {
      throw new UnprocessableEntityException({
        code: 'NEIGHBOURHOOD_UNKNOWN',
        message: 'Ce quartier ne fait pas partie de la liste.',
      });
    }
  }

  /** FEAT-022 (SPEC-022-02 R4, SPEC-022-03 R2): in the account's transaction. */
  private async provision(
    tx: Prisma.TransactionClient,
    userId: string,
    signup: SignupPayload,
  ): Promise<void> {
    const termsAcceptedAt = new Date(signup.termsAcceptedAt);
    if (signup.type === 'courier') {
      await this.courierOnboarding.provisionCourier(tx, userId, {
        vehicle: signup.vehicle,
        birthDate: signup.birthDate,
        neighbourhoodId: signup.neighbourhoodId,
        neighbourhoodOther: signup.neighbourhoodOther,
        termsAcceptedAt,
      });
      await this.users.grantRoleWithin(tx, userId, { role: 'courier' });
      return;
    }
    const { restaurantId } = await this.restaurantOnboarding.provisionRestaurant(tx, userId, {
      restaurantName: signup.restaurantName,
      neighbourhoodId: signup.neighbourhoodId,
      neighbourhoodOther: signup.neighbourhoodOther,
      termsAcceptedAt,
    });
    await this.users.grantRoleWithin(tx, userId, { role: 'restaurant_owner', restaurantId });
  }

  private pending(id: string) {
    return this.prisma.authChallenge.findFirst({
      where: { id, kind: 'registration', consumedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  /** R11 (FEAT-020-Q15): a hash, a name and a number have no use once expired. */
  private async purgeExpired(): Promise<void> {
    await this.prisma.authChallenge.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
