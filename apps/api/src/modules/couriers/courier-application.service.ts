import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CourierApplication, Prisma } from '@prisma/client';
import { LAUNCH_MARKET } from '@djafat/config';
import {
  FieldValidationError,
  ageOn,
  applicationIsDecidable,
  applicationIsEditable,
  courierApplicationItems,
  courierDocumentKinds,
  isApplicationStatus,
  isCourierVehicle,
  maskNationalPhone,
  missingCourierItems,
  ndjamenaDate,
  vehicleNeedsPapers,
  type ApplicationStatus,
  type CourierDocumentKind,
  type CourierItem,
  type CourierVehicle,
  type MobileMoneyProvider,
} from '@djafat/core';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PRIVATE_LINK_SECONDS, PhotoStorage } from '../../infra/storage/photo-storage';
import { NeighbourhoodsService } from '../geo/neighbourhoods.service';
import { UsersService } from '../users/users.service';

/** What the courier sees of their own application (« Avant votre première course »). */
export interface CourierApplicationView {
  readonly status: ApplicationStatus;
  readonly vehicle: CourierVehicle | null;
  /** SPEC-022-06 R1, R3: the items asked for this vehicle, in the list's order. */
  readonly items: ReadonlyArray<{ readonly item: CourierItem; readonly done: boolean }>;
  /** The photos asked for this vehicle, and which ones were sent. */
  readonly photos: ReadonlyArray<{
    readonly kind: CourierDocumentKind;
    readonly uploaded: boolean;
  }>;
  readonly mobileMoney: { readonly provider: MobileMoneyProvider; readonly number: string } | null;
  readonly emergencyContact: { readonly name: string; readonly phone: string } | null;
  /** The last rejection's reason (SPEC-022-06 R6); shown while `rejected`. */
  readonly rejectionReason: string | null;
  readonly submittedAt: string | null;
}

/** A row of the admin's queue (SPEC-022-07 R1). */
export interface CourierApplicationQueueRow {
  readonly id: string;
  readonly name: string | null;
  readonly neighbourhood: string | null;
  readonly submittedAt: string;
}

/** The admin's detail (SPEC-022-07 R2): the Mobile Money number is masked. */
export interface CourierApplicationReview {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly name: string | null;
  readonly birthDate: string | null;
  readonly age: number | null;
  readonly vehicle: CourierVehicle | null;
  readonly neighbourhood: string | null;
  readonly photos: ReadonlyArray<{
    readonly kind: CourierDocumentKind;
    readonly uploaded: boolean;
  }>;
  readonly mobileMoney: { readonly provider: MobileMoneyProvider; readonly number: string } | null;
  readonly emergencyContact: { readonly name: string; readonly phone: string } | null;
  readonly submittedAt: string | null;
  /** A rejected application sent again keeps the previous reason, for the reviewer. */
  readonly previousRejectionReason: string | null;
}

export interface CourierApplicationUpdate {
  readonly vehicle?: CourierVehicle | undefined;
  readonly mobileMoney?:
    | { readonly provider: MobileMoneyProvider; readonly number: string }
    | undefined;
  readonly emergencyContact?: { readonly name: string; readonly phone: string } | undefined;
}

/** The courier whose application DJAFAT decided, for the e-mail (SPEC-022-07 R5). */
export interface CourierDecision {
  readonly courierUserId: string;
  readonly status: 'approved' | 'rejected';
}

const PHOTO_COLUMN = {
  face: 'facePhotoKey',
  id_card: 'idCardPhotoKey',
  driving_licence: 'drivingLicencePhotoKey',
  vehicle_registration: 'vehicleRegistrationPhotoKey',
  insurance: 'insurancePhotoKey',
  plate: 'platePhotoKey',
} as const satisfies Record<CourierDocumentKind, keyof CourierApplication>;

const notFound = () =>
  new NotFoundException({
    code: 'APPLICATION_NOT_FOUND',
    message: "Ce compte n'a pas de dossier de livreur.",
  });

const locked = () =>
  new ConflictException({
    code: 'APPLICATION_LOCKED',
    message: 'Votre dossier est en vérification ou déjà validé : il ne se modifie plus ici.',
  });

/**
 * FEAT-022 (SPEC-022-06, SPEC-022-07 for couriers): a courier's application —
 * filled and sent by the courier, decided by DJAFAT. Every change to one
 * application holds the same transaction lock, so a photo, a submit and two
 * admins' decisions never interleave (SPEC-022-07 R7). The `admin` module
 * adds the e-mails; this service owns the state.
 */
@Injectable()
export class CourierApplicationService {
  private readonly logger = new Logger(CourierApplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotoStorage,
    private readonly users: UsersService,
    private readonly neighbourhoods: NeighbourhoodsService,
    private readonly audit: AuditService,
  ) {}

  // ── The courier ────────────────────────────────────────────────────────────

  async getMine(userId: string): Promise<CourierApplicationView> {
    const { application, vehicle } = await this.load(userId);
    const missing = new Set(this.missing(application, vehicle));
    const items = vehicle ? courierApplicationItems(vehicle) : [];
    return {
      status: this.statusOf(application),
      vehicle,
      items: items.map((item) => ({ item, done: !missing.has(item) })),
      photos: this.photoList(application, vehicle),
      mobileMoney: this.mobileMoneyOf(application),
      emergencyContact: this.emergencyContactOf(application),
      rejectionReason: application.status === 'rejected' ? application.rejectionReason : null,
      submittedAt: application.submittedAt?.toISOString() ?? null,
    };
  }

  /** R7: the vehicle, the Mobile Money number, the emergency contact — before sending or after a rejection. */
  async updateMine(
    userId: string,
    input: CourierApplicationUpdate,
  ): Promise<CourierApplicationView> {
    if (input.emergencyContact) {
      const own = (await this.users.getById(userId))?.phone;
      if (own && own === input.emergencyContact.phone) {
        throw new FieldValidationError([
          {
            path: 'emergencyContact.phone',
            message: "Le contact d'urgence doit avoir un autre numéro que le vôtre.",
          },
        ]);
      }
    }
    const dropped = await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, userId);
      if (!applicationIsEditable(this.statusOf(application))) throw locked();
      const now = new Date();
      // R3: on a bicycle or on foot, the licence and the vehicle papers are neither asked nor
      // kept — their photos go with the change (review of FEAT-022 parts 1-2, note 18).
      const unneeded =
        input.vehicle && !vehicleNeedsPapers(input.vehicle)
          ? (['driving_licence', 'vehicle_registration', 'insurance', 'plate'] as const)
          : [];
      const droppedKeys = unneeded.flatMap((kind) => {
        const key = application[PHOTO_COLUMN[kind]];
        return key ? [key] : [];
      });
      await tx.courierApplication.update({
        where: { courierUserId: userId },
        data: {
          ...Object.fromEntries(unneeded.map((kind) => [PHOTO_COLUMN[kind], null])),
          ...(input.mobileMoney
            ? {
                mobileMoneyProvider: input.mobileMoney.provider,
                mobileMoneyNumber: input.mobileMoney.number,
              }
            : {}),
          ...(input.emergencyContact
            ? {
                emergencyContactName: input.emergencyContact.name,
                emergencyContactPhone: input.emergencyContact.phone,
              }
            : {}),
          updatedAt: now,
        },
      });
      if (input.vehicle) {
        await tx.courier.update({
          where: { userId },
          data: { vehicleType: input.vehicle, updatedAt: now },
        });
      }
      return droppedKeys;
    });
    for (const key of dropped) await this.removeQuietly(key);
    return this.getMine(userId);
  }

  /**
   * R2 (SPEC-022-04): one photo into the private storage. The replaced photo
   * is deleted once the new key is saved; a refused change leaves nothing behind.
   */
  async storeDocument(
    userId: string,
    kind: CourierDocumentKind,
    bytes: Uint8Array,
  ): Promise<CourierApplicationView> {
    const before = await this.load(userId);
    if (!applicationIsEditable(this.statusOf(before.application))) throw locked();
    const { key } = await this.photos.store('private', bytes);
    let previous: string | null;
    try {
      previous = await this.prisma.$transaction(async (tx) => {
        const application = await this.lockedRow(tx, userId);
        if (!applicationIsEditable(this.statusOf(application))) throw locked();
        const data: Prisma.CourierApplicationUpdateInput = { updatedAt: new Date() };
        data[PHOTO_COLUMN[kind]] = key;
        await tx.courierApplication.update({ where: { courierUserId: userId }, data });
        return application[PHOTO_COLUMN[kind]];
      });
    } catch (err) {
      await this.removeQuietly(key);
      throw err;
    }
    if (previous && previous !== key) await this.removeQuietly(previous);
    return this.getMine(userId);
  }

  /** SPEC-022-04 R3: a 5-minute link to one photo — for its owner, or an admin (checked by the route). */
  async documentLink(
    userId: string,
    kind: CourierDocumentKind,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const { application } = await this.load(userId);
    const key = application[PHOTO_COLUMN[kind]];
    if (!key) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Aucune photo envoyée.' });
    }
    return { url: await this.photos.link(key), expiresInSeconds: PRIVATE_LINK_SECONDS };
  }

  /** R4: sent only when complete (409 with what is missing); then it waits for DJAFAT. */
  async submit(userId: string): Promise<CourierApplicationView> {
    await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, userId);
      const status = this.statusOf(application);
      if (!applicationIsEditable(status)) throw locked();
      const courier = await tx.courier.findUniqueOrThrow({
        where: { userId },
        select: { vehicleType: true },
      });
      const vehicle = isCourierVehicle(courier.vehicleType) ? courier.vehicleType : null;
      const missing = vehicle ? this.missing(application, vehicle) : ['vehicle'];
      if (missing.length > 0) {
        throw new ConflictException({
          code: 'APPLICATION_INCOMPLETE',
          message: 'Il manque des éléments à votre dossier.',
          details: { missing },
        });
      }
      const now = new Date();
      await tx.courierApplication.update({
        where: { courierUserId: userId },
        data: { status: 'pending_review', submittedAt: now, updatedAt: now },
      });
      await this.audit.log(
        {
          actorUserId: userId,
          action: 'APPLICATION_SUBMITTED',
          entityType: 'courier_application',
          entityId: userId,
          metadata: { again: status === 'rejected' },
        },
        tx,
      );
    });
    return this.getMine(userId);
  }

  // ── DJAFAT's review (called by the `admin` module) ─────────────────────────

  /** SPEC-022-07 R1: the applications waiting for DJAFAT, oldest first. */
  async listPendingForReview(): Promise<CourierApplicationQueueRow[]> {
    const rows = await this.prisma.courierApplication.findMany({
      where: { status: 'pending_review' },
      orderBy: { submittedAt: 'asc' },
      select: { courierUserId: true, submittedAt: true },
    });
    if (rows.length === 0) return [];
    const [names, places] = await Promise.all([
      this.namesOf(rows.map((r) => r.courierUserId)),
      this.placesOf(rows.map((r) => r.courierUserId)),
    ]);
    return rows
      .filter((r) => names.has(r.courierUserId))
      .map((r) => ({
        id: r.courierUserId,
        name: names.get(r.courierUserId) ?? null,
        neighbourhood: places.get(r.courierUserId) ?? null,
        submittedAt: (r.submittedAt ?? new Date(0)).toISOString(),
      }));
  }

  /** SPEC-022-07 R2 (courier): name, birth date and age, vehicle, neighbourhood, photos, Mobile Money, contact. */
  async getForReview(userId: string): Promise<CourierApplicationReview> {
    const user = await this.users.getById(userId);
    if (!user || user.status === 'deleted') throw notFound();
    const { application, vehicle, courier } = await this.load(userId);
    const birthDate = courier.birthDate ? courier.birthDate.toISOString().slice(0, 10) : null;
    const mobileMoney = this.mobileMoneyOf(application);
    return {
      id: userId,
      status: this.statusOf(application),
      name: user.fullName,
      birthDate,
      age: birthDate ? ageOn(birthDate, ndjamenaDate(new Date())) : null,
      vehicle,
      neighbourhood: (await this.placesOf([userId])).get(userId) ?? null,
      photos: this.photoList(application, vehicle),
      mobileMoney: mobileMoney && {
        provider: mobileMoney.provider,
        number: maskNationalPhone(mobileMoney.number, LAUNCH_MARKET),
      },
      emergencyContact: this.emergencyContactOf(application),
      submittedAt: application.submittedAt?.toISOString() ?? null,
      previousRejectionReason:
        application.status === 'pending_review' ? application.rejectionReason : null,
    };
  }

  /** SPEC-022-07 R3: approved — the courier can go online. 409 `ALREADY_DECIDED` if not waiting (R7). */
  approve(userId: string, adminUserId: string): Promise<CourierDecision> {
    return this.decide(userId, adminUserId, { status: 'approved' });
  }

  /** SPEC-022-07 R4: rejected with its reason (already checked: 10 to 500 characters). */
  reject(userId: string, adminUserId: string, reason: string): Promise<CourierDecision> {
    return this.decide(userId, adminUserId, { status: 'rejected', reason });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async decide(
    userId: string,
    adminUserId: string,
    decision: { status: 'approved' } | { status: 'rejected'; reason: string },
  ): Promise<CourierDecision> {
    const user = await this.users.getById(userId);
    if (!user || user.status === 'deleted') throw notFound();
    await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, userId);
      const status = this.statusOf(application);
      if (status === 'to_complete') {
        throw new ConflictException({
          code: 'APPLICATION_NOT_SUBMITTED',
          message: "Ce dossier n'a pas encore été envoyé par le livreur.",
        });
      }
      if (!applicationIsDecidable(status)) {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: 'Ce dossier a déjà été décidé par un autre administrateur.',
        });
      }
      const now = new Date();
      await tx.courierApplication.update({
        where: { courierUserId: userId },
        data: {
          status: decision.status,
          decidedAt: now,
          decidedBy: adminUserId,
          updatedAt: now,
          ...(decision.status === 'rejected' ? { rejectionReason: decision.reason } : {}),
        },
      });
      await this.audit.log(
        {
          actorUserId: adminUserId,
          action: decision.status === 'approved' ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED',
          entityType: 'courier_application',
          entityId: userId,
          metadata: decision.status === 'rejected' ? { reason: decision.reason } : null,
        },
        tx,
      );
    });
    return { courierUserId: userId, status: decision.status };
  }

  private async load(userId: string): Promise<{
    application: CourierApplication;
    vehicle: CourierVehicle | null;
    courier: { vehicleType: string | null; birthDate: Date | null };
  }> {
    const courier = await this.prisma.courier.findUnique({
      where: { userId },
      select: { vehicleType: true, birthDate: true },
    });
    const application = await this.prisma.courierApplication.findUnique({
      where: { courierUserId: userId },
    });
    if (!courier || !application) throw notFound();
    const vehicle = isCourierVehicle(courier.vehicleType) ? courier.vehicleType : null;
    return { application, vehicle, courier };
  }

  /** The application row, locked for this transaction (one change at a time per application). */
  private async lockedRow(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<CourierApplication> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`courier-application:${userId}`}))`;
    const application = await tx.courierApplication.findUnique({
      where: { courierUserId: userId },
    });
    if (!application) throw notFound();
    return application;
  }

  private statusOf(application: CourierApplication): ApplicationStatus {
    return isApplicationStatus(application.status) ? application.status : 'to_complete';
  }

  private missing(application: CourierApplication, vehicle: CourierVehicle | null): CourierItem[] {
    if (!vehicle) return [];
    return missingCourierItems({
      vehicle,
      hasFacePhoto: application.facePhotoKey !== null,
      hasIdCardPhoto: application.idCardPhotoKey !== null,
      hasDrivingLicencePhoto: application.drivingLicencePhotoKey !== null,
      hasRegistrationPhoto: application.vehicleRegistrationPhotoKey !== null,
      hasInsurancePhoto: application.insurancePhotoKey !== null,
      hasPlatePhoto: application.platePhotoKey !== null,
      hasMobileMoney: this.mobileMoneyOf(application) !== null,
      hasEmergencyContact: this.emergencyContactOf(application) !== null,
    });
  }

  private photoList(
    application: CourierApplication,
    vehicle: CourierVehicle | null,
  ): Array<{ kind: CourierDocumentKind; uploaded: boolean }> {
    const kinds = vehicle ? courierDocumentKinds(vehicle) : courierDocumentKinds('moto');
    return kinds.map((kind) => ({ kind, uploaded: application[PHOTO_COLUMN[kind]] !== null }));
  }

  private mobileMoneyOf(
    application: CourierApplication,
  ): { provider: MobileMoneyProvider; number: string } | null {
    const provider = application.mobileMoneyProvider;
    if ((provider !== 'airtel' && provider !== 'moov') || !application.mobileMoneyNumber) {
      return null;
    }
    return { provider, number: application.mobileMoneyNumber };
  }

  private emergencyContactOf(
    application: CourierApplication,
  ): { name: string; phone: string } | null {
    if (!application.emergencyContactName || !application.emergencyContactPhone) return null;
    return { name: application.emergencyContactName, phone: application.emergencyContactPhone };
  }

  /** Account names; a deleted account drops out of the queue (SPEC-022-07: decided as 404). */
  private async namesOf(userIds: string[]): Promise<Map<string, string | null>> {
    const users = await Promise.all(userIds.map((id) => this.users.getById(id)));
    const names = new Map<string, string | null>();
    for (const user of users) {
      if (user && user.status !== 'deleted') names.set(user.id, user.fullName);
    }
    return names;
  }

  /** The neighbourhood's name — kept even once disabled (SPEC-022-09-SC03) — or the one typed under « Autre ». */
  private async placesOf(userIds: string[]): Promise<Map<string, string | null>> {
    const [couriers, all] = await Promise.all([
      this.prisma.courier.findMany({
        where: { userId: { in: userIds } },
        select: { userId: true, neighbourhoodId: true, neighbourhoodOther: true },
      }),
      this.neighbourhoods.listAll(LAUNCH_MARKET.citySlug),
    ]);
    const names = new Map(all.map((n) => [n.id, n.name]));
    return new Map(
      couriers.map((c) => [
        c.userId,
        (c.neighbourhoodId ? names.get(c.neighbourhoodId) : null) ?? c.neighbourhoodOther ?? null,
      ]),
    );
  }

  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.photos.remove(key);
    } catch (err) {
      this.logger.warn(
        `Photo ${key.slice(0, 12)}… not removed: ${err instanceof Error ? err.message : 'error'}`,
      );
    }
  }
}
