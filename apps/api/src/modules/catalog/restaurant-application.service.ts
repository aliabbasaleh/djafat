import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, RestaurantApplication } from '@prisma/client';
import { LAUNCH_MARKET } from '@djafat/config';
import {
  RESTAURANT_STEPS,
  applicationIsDecidable,
  applicationIsEditable,
  isApplicationStatus,
  maskNationalPhone,
  missingRestaurantSteps,
  restaurantStepsDone,
  type ApplicationStatus,
  type MobileMoneyProvider,
  type RestaurantApplicationFacts,
  type RestaurantStep,
} from '@djafat/core';
import { AuditService } from '../../common/audit/audit.service';
import {
  changeMobileMoney,
  changeTopic,
  changeValue,
  dropPendingChange,
  listPendingChanges,
  markChangeDecided,
  pendingChangeToDecide,
  pendingChangesOf,
  queueChange,
  toPendingChange,
  type ChangeDecision,
  type ChangeVerdict,
  type PendingChange,
  type PendingChangeRow,
} from '../../common/onboarding/application-changes.repository';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PRIVATE_LINK_SECONDS, PhotoStorage } from '../../infra/storage/photo-storage';
import { NeighbourhoodsService } from '../geo/neighbourhoods.service';
import { UsersService } from '../users/users.service';

/** A row of the admin's queue (SPEC-022-07 R1). */
export interface RestaurantApplicationQueueRow {
  readonly id: string;
  readonly name: string;
  readonly neighbourhood: string | null;
  readonly submittedAt: string;
}

export interface RestaurantLocation {
  readonly lat: number | null;
  readonly lng: number | null;
  readonly addressText: string | null;
  readonly landmark: string | null;
}

/** A restaurant's change waiting for DJAFAT, in the admin's queue (SPEC-022-07 R6). */
export interface RestaurantChangeQueueRow extends PendingChangeRow {
  readonly name: string;
}

/** What the owner sees of their restaurant's application (SPEC-022-05, FEAT-022-VIS04). */
export interface RestaurantApplicationView {
  readonly restaurantId: string;
  readonly name: string;
  readonly status: ApplicationStatus;
  readonly steps: ReadonlyArray<{ readonly step: RestaurantStep; readonly done: boolean }>;
  readonly location: RestaurantLocation;
  readonly photos: { readonly logoUrl: string | null; readonly coverUrl: string | null };
  readonly papers: {
    readonly registryNumber: string | null;
    readonly registryPhoto: boolean;
    readonly ownerIdPhoto: boolean;
  };
  readonly mobileMoney: { readonly provider: MobileMoneyProvider; readonly number: string } | null;
  readonly rejectionReason: string | null;
  readonly submittedAt: string | null;
  readonly pendingChanges: readonly PendingChange[];
}

/** The admin's detail (SPEC-022-07 R2): the numbers are masked, the papers open by signed link. */
export interface RestaurantApplicationReview {
  readonly id: string;
  readonly status: ApplicationStatus;
  readonly name: string;
  readonly neighbourhood: string | null;
  readonly owner: { readonly name: string | null; readonly phone: string | null };
  readonly location: RestaurantLocation;
  readonly hasOpeningHours: boolean;
  readonly pricedProducts: number;
  readonly logoUrl: string | null;
  readonly coverUrl: string | null;
  readonly registryNumber: string | null;
  readonly papers: { readonly registryPhoto: boolean; readonly ownerIdPhoto: boolean };
  readonly mobileMoney: { readonly provider: MobileMoneyProvider; readonly number: string } | null;
  readonly submittedAt: string | null;
  readonly previousRejectionReason: string | null;
  /** R6: what changed since the approval and waits for a decision (numbers masked). */
  readonly pendingChanges: readonly PendingChange[];
}

/** A change DJAFAT decided, for the e-mail to the owner (SPEC-022-07 R5, R6). */
export interface RestaurantChangeDecision extends ChangeDecision {
  readonly restaurantId: string;
  readonly ownerUserId: string | null;
  readonly name: string;
}

/** The restaurant DJAFAT decided, for the e-mail to its owner (SPEC-022-07 R5). */
export interface RestaurantDecision {
  readonly restaurantId: string;
  readonly ownerUserId: string | null;
  readonly name: string;
  readonly status: 'approved' | 'rejected';
}

export interface RestaurantPapersUpdate {
  readonly registryNumber?: string | undefined;
  readonly mobileMoney?:
    | { readonly provider: MobileMoneyProvider; readonly number: string }
    | undefined;
}

const PAPER_COLUMN = {
  registry: 'registryPhotoKey',
  owner_id: 'ownerIdPhotoKey',
} as const satisfies Record<string, keyof RestaurantApplication>;
/** The private papers of step 4, which open only by a signed link (SPEC-022-04 R3). */
export type PaperKind = keyof typeof PAPER_COLUMN;

/** A public photo's address, as `PhotoStorage.link` gives it: its key is at the end. */
const PUBLIC_KEY_IN_URL = /\/files\/(public-[0-9a-f-]{36}\.(?:jpg|png|webp))$/;

const notFound = () =>
  new NotFoundException({
    code: 'APPLICATION_NOT_FOUND',
    message: "Ce restaurant n'a pas de dossier d'inscription.",
  });

/** R8, FEAT-022-Q17: never one's own restaurant, nor its changes. */
const ownRestaurant = () =>
  new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'Votre propre restaurant doit être décidé par un autre administrateur.',
  });

const locked = () =>
  new ConflictException({
    code: 'APPLICATION_LOCKED',
    message: 'Votre dossier est en vérification : il ne se modifie plus pour le moment.',
  });

/**
 * FEAT-022 (SPEC-022-05, SPEC-022-07 for restaurants): a restaurant's
 * application — filled and sent by its owner in four steps, decided by
 * DJAFAT. Every change holds the same transaction lock, so a photo, a submit
 * and two admins' decisions never interleave (SPEC-022-07 R7). After the
 * approval, a new Mobile Money number or a new paper waits for an admin
 * (R6); the `admin` module composes the decisions and their e-mails.
 */
@Injectable()
export class RestaurantApplicationService {
  private readonly logger = new Logger(RestaurantApplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly neighbourhoods: NeighbourhoodsService,
    private readonly photos: PhotoStorage,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  // ── The owner ─────────────────────────────────────────────────────────────

  async getMine(userId: string): Promise<RestaurantApplicationView> {
    return this.view(await this.scopedRestaurant(userId));
  }

  /** Step 1 (SPEC-022-05 R1): the point on the map, the address, a landmark. */
  async updateLocation(
    userId: string,
    input: { lat: number; lng: number; addressText: string; landmark?: string | undefined },
  ): Promise<RestaurantApplicationView> {
    const restaurantId = await this.scopedRestaurant(userId);
    await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, restaurantId);
      if (this.statusOf(application) === 'pending_review') throw locked(); // R5
      await tx.$executeRaw`
        UPDATE restaurants
           SET address_text = ${input.addressText},
               landmark = ${input.landmark ?? null},
               geom = ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)::geography,
               updated_at = now()
         WHERE id = ${restaurantId}::uuid`;
    });
    return this.view(restaurantId);
  }

  /**
   * Step 4 (R1): the RCCM or NIF number and the Mobile Money number. Once
   * approved, they wait for an admin instead (SPEC-022-07 R6): payments keep
   * going to the approved number until then.
   */
  async updatePapers(
    userId: string,
    input: RestaurantPapersUpdate,
  ): Promise<RestaurantApplicationView> {
    const restaurantId = await this.scopedRestaurant(userId);
    await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, restaurantId);
      const status = this.statusOf(application);
      if (status === 'pending_review') throw locked();
      if (status === 'approved') {
        // R6: waits for an admin; the approved value again withdraws the change.
        const mobileMoney = input.mobileMoney;
        if (mobileMoney) {
          if (
            mobileMoney.provider === application.mobileMoneyProvider &&
            mobileMoney.number === application.mobileMoneyNumber
          ) {
            await dropPendingChange(tx, 'restaurant', restaurantId, 'mobile_money');
          } else {
            await queueChange(tx, 'restaurant', restaurantId, 'mobile_money', {
              provider: mobileMoney.provider,
              number: mobileMoney.number,
            });
          }
        }
        if (input.registryNumber !== undefined) {
          if (input.registryNumber === application.registryNumber) {
            await dropPendingChange(tx, 'restaurant', restaurantId, 'registry_number');
          } else {
            await queueChange(tx, 'restaurant', restaurantId, 'document', {
              registryNumber: input.registryNumber,
            });
          }
        }
        return;
      }
      await tx.restaurantApplication.update({
        where: { restaurantId },
        data: {
          updatedAt: new Date(),
          ...(input.registryNumber !== undefined ? { registryNumber: input.registryNumber } : {}),
          ...(input.mobileMoney
            ? {
                mobileMoneyProvider: input.mobileMoney.provider,
                mobileMoneyNumber: input.mobileMoney.number,
              }
            : {}),
        },
      });
    });
    return this.view(restaurantId);
  }

  /**
   * Step 3 (R1, R2 — the profile page): the logo or the cover, public
   * (SPEC-022-04 R4). Stored before the lock (it can be large), then attached
   * under it. A restaurant created by the team has no application and changes
   * them all the same; during the review they do not change (R5).
   */
  async storePublicPhoto(
    userId: string,
    kind: 'logo' | 'cover',
    bytes: Uint8Array,
  ): Promise<{ logoUrl: string | null; coverUrl: string | null }> {
    const restaurantId = await this.scopedRestaurant(userId);
    const { key } = await this.photos.store('public', bytes);
    let replaced: string | null = null;
    let photos: { logoUrl: string | null; coverUrl: string | null };
    try {
      [replaced, photos] = await this.prisma.$transaction(async (tx) => {
        if (await this.hasApplication(tx, restaurantId)) {
          const application = await this.lockedRow(tx, restaurantId);
          if (this.statusOf(application) === 'pending_review') throw locked();
        }
        const column = kind === 'logo' ? 'logoUrl' : 'coverUrl';
        const before = await tx.restaurant.findUniqueOrThrow({
          where: { id: restaurantId },
          select: { logoUrl: true, coverUrl: true },
        });
        const after = await tx.restaurant.update({
          where: { id: restaurantId },
          data: { [column]: await this.photos.link(key), updatedAt: new Date() },
          select: { logoUrl: true, coverUrl: true },
        });
        return [publicKeyOf(before[column]), after] as const;
      });
    } catch (err) {
      await this.removeQuietly(key);
      throw err;
    }
    if (replaced && replaced !== key) await this.removeQuietly(replaced);
    return { logoUrl: photos.logoUrl, coverUrl: photos.coverUrl };
  }

  /**
   * Step 4 (R1): the RCCM or NIF photo, or the owner's ID — private
   * (SPEC-022-04 R3). Once approved, a new paper waits for an admin, the
   * approved one stays (SPEC-022-07 R6).
   */
  async storePaper(
    userId: string,
    kind: PaperKind,
    bytes: Uint8Array,
  ): Promise<RestaurantApplicationView> {
    const restaurantId = await this.scopedRestaurant(userId);
    const { key } = await this.photos.store('private', bytes);
    let replaced: string | null = null;
    try {
      replaced = await this.prisma.$transaction(async (tx) => {
        const application = await this.lockedRow(tx, restaurantId);
        const status = this.statusOf(application);
        if (status === 'pending_review') throw locked();
        if (status === 'approved') {
          return queueChange(tx, 'restaurant', restaurantId, 'document', { kind, key });
        }
        const data: Prisma.RestaurantApplicationUpdateInput = { updatedAt: new Date() };
        data[PAPER_COLUMN[kind]] = key;
        await tx.restaurantApplication.update({ where: { restaurantId }, data });
        return application[PAPER_COLUMN[kind]];
      });
    } catch (err) {
      await this.removeQuietly(key);
      throw err;
    }
    if (replaced && replaced !== key) await this.removeQuietly(replaced);
    return this.view(restaurantId);
  }

  /** SPEC-022-04 R3: a 5-minute link to one of its own papers. */
  async documentLink(
    userId: string,
    kind: PaperKind,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.linkOf(await this.scopedRestaurant(userId), kind);
  }

  /** R3, R6: sent only when the four steps are filled (409 with what is missing). */
  async submit(userId: string): Promise<RestaurantApplicationView> {
    const restaurantId = await this.scopedRestaurant(userId);
    await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, restaurantId);
      if (!applicationIsEditable(this.statusOf(application))) throw locked();
      const { facts } = await this.facts(tx, restaurantId, application);
      const missing = missingRestaurantSteps(facts);
      if (missing.length > 0) {
        throw new ConflictException({
          code: 'APPLICATION_INCOMPLETE',
          message: 'Il reste des étapes à compléter.',
          details: { missing },
        });
      }
      const now = new Date();
      await tx.restaurantApplication.update({
        where: { restaurantId },
        data: { status: 'pending_review', submittedAt: now, updatedAt: now },
      });
      await tx.restaurant.update({
        where: { id: restaurantId },
        data: { status: 'pending_review', updatedAt: now },
      });
      await this.audit.log(
        {
          actorUserId: userId,
          action: 'APPLICATION_SUBMITTED',
          entityType: 'restaurant_application',
          entityId: restaurantId,
        },
        tx,
      );
    });
    return this.view(restaurantId);
  }

  // ── DJAFAT ────────────────────────────────────────────────────────────────

  /** SPEC-022-07 R1: the applications waiting for DJAFAT, oldest first — never a draft. */
  async listPendingForReview(): Promise<RestaurantApplicationQueueRow[]> {
    const rows = await this.prisma.restaurantApplication.findMany({
      where: { status: 'pending_review' },
      orderBy: { submittedAt: 'asc' },
      select: { restaurantId: true, submittedAt: true },
    });
    if (rows.length === 0) return [];
    const [restaurants, names] = await Promise.all([
      this.prisma.restaurant.findMany({
        where: { id: { in: rows.map((r) => r.restaurantId) } },
        select: { id: true, name: true, neighbourhoodId: true, neighbourhoodOther: true },
      }),
      this.neighbourhoodNames(),
    ]);
    const byId = new Map(restaurants.map((r) => [r.id, r]));
    return rows.flatMap((row) => {
      const restaurant = byId.get(row.restaurantId);
      if (!restaurant) return [];
      return [
        {
          id: restaurant.id,
          name: restaurant.name,
          neighbourhood: neighbourhoodOf(restaurant, names),
          submittedAt: (row.submittedAt ?? new Date(0)).toISOString(),
        },
      ];
    });
  }

  /** SPEC-022-07 R2: everything the admin checks, the papers by signed link (R3). */
  async getForReview(restaurantId: string): Promise<RestaurantApplicationReview> {
    const application = await this.prisma.restaurantApplication.findUnique({
      where: { restaurantId },
    });
    if (!application) throw notFound();
    const { facts, restaurant, location } = await this.facts(
      this.prisma,
      restaurantId,
      application,
    );
    const [owner, names] = await Promise.all([
      restaurant.ownerUserId ? this.users.getById(restaurant.ownerUserId) : Promise.resolve(null),
      this.neighbourhoodNames(),
    ]);
    const status = this.statusOf(application);
    return {
      id: restaurantId,
      status,
      name: restaurant.name,
      neighbourhood: neighbourhoodOf(restaurant, names),
      owner: {
        name: owner?.fullName ?? null,
        phone: owner ? maskNationalPhone(owner.phone, LAUNCH_MARKET) : null,
      },
      location,
      hasOpeningHours: facts.hasOpeningHours,
      pricedProducts: facts.pricedProducts,
      logoUrl: restaurant.logoUrl,
      coverUrl: restaurant.coverUrl,
      registryNumber: application.registryNumber,
      papers: { registryPhoto: facts.hasRegistryPhoto, ownerIdPhoto: facts.hasOwnerIdPhoto },
      mobileMoney: this.mobileMoneyOf(application, true),
      submittedAt: application.submittedAt?.toISOString() ?? null,
      previousRejectionReason: status === 'pending_review' ? application.rejectionReason : null,
      pendingChanges: (await pendingChangesOf(this.prisma, 'restaurant', restaurantId)).map(
        (change) => toPendingChange(change, (n) => maskNationalPhone(n, LAUNCH_MARKET)),
      ),
    };
  }

  /** SPEC-022-09 R3, SC02: the neighbourhood names restaurants typed under « Autre », with how many. */
  async otherNeighbourhoodNames(): Promise<Array<{ name: string; count: number }>> {
    const rows = await this.prisma.restaurant.groupBy({
      by: ['neighbourhoodOther'],
      where: { neighbourhoodId: null, neighbourhoodOther: { not: null } },
      _count: { _all: true },
    });
    return rows.flatMap((row) =>
      row.neighbourhoodOther ? [{ name: row.neighbourhoodOther, count: row._count._all }] : [],
    );
  }

  /** SPEC-022-07 R6: the restaurants' changes waiting for DJAFAT, oldest first. */
  async listPendingChangesForReview(): Promise<RestaurantChangeQueueRow[]> {
    const rows = await listPendingChanges(this.prisma, 'restaurant');
    if (rows.length === 0) return [];
    const restaurants = await this.prisma.restaurant.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.subjectId))] } },
      select: { id: true, name: true },
    });
    const names = new Map(restaurants.map((r) => [r.id, r.name]));
    return rows.flatMap((row) => {
      const name = names.get(row.subjectId);
      return name === undefined ? [] : [{ ...row, name }];
    });
  }

  /** R6: the photo of a pending paper, by a 5-minute link (the route admits admins only). */
  async changeLinkForReview(
    restaurantId: string,
    changeId: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const change = await this.prisma.applicationChange.findUnique({ where: { id: changeId } });
    const key =
      change && change.subjectType === 'restaurant' && change.subjectId === restaurantId
        ? changeValue(change.newValue, 'key')
        : null;
    if (!key) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Aucune photo envoyée.' });
    }
    return { url: await this.photos.link(key), expiresInSeconds: PRIVATE_LINK_SECONDS };
  }

  /**
   * R6: an admin accepts a change — the new number is paid from now on, the
   * new paper replaces the old one — or refuses it with a reason (the
   * approved value stays). Never the admin's own restaurant (R8).
   */
  async decideChange(
    restaurantId: string,
    changeId: string,
    adminUserId: string,
    verdict: ChangeVerdict,
  ): Promise<RestaurantChangeDecision> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { name: true, ownerUserId: true },
    });
    if (!restaurant) throw notFound();
    if (restaurant.ownerUserId === adminUserId) throw ownRestaurant();
    let removed: string | null = null;
    const decided = await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, restaurantId);
      const change = await pendingChangeToDecide(tx, 'restaurant', restaurantId, changeId);
      const topic = changeTopic(change.kind, change.newValue);
      if (verdict.status === 'approved') {
        const data: Prisma.RestaurantApplicationUpdateInput = { updatedAt: new Date() };
        const mobileMoney = changeMobileMoney(change);
        const key = changeValue(change.newValue, 'key');
        if (mobileMoney) {
          data.mobileMoneyProvider = mobileMoney.provider;
          data.mobileMoneyNumber = mobileMoney.number;
        } else if (topic === 'registry_number') {
          data.registryNumber = changeValue(change.newValue, 'registryNumber');
        } else if ((topic === 'registry' || topic === 'owner_id') && key) {
          data[PAPER_COLUMN[topic]] = key;
          removed = application[PAPER_COLUMN[topic]];
        }
        await tx.restaurantApplication.update({ where: { restaurantId }, data });
      } else {
        removed = changeValue(change.newValue, 'key'); // the refused photo is not kept
      }
      await markChangeDecided(tx, changeId, adminUserId, verdict);
      await this.audit.log(
        {
          actorUserId: adminUserId,
          action: verdict.status === 'approved' ? 'CHANGE_APPROVED' : 'CHANGE_REJECTED',
          entityType: 'restaurant_application',
          entityId: restaurantId,
          metadata: {
            changeId,
            topic,
            ...(verdict.status === 'rejected' ? { reason: verdict.reason } : {}),
          },
        },
        tx,
      );
      return {
        changeId,
        kind: change.kind === 'mobile_money' ? ('mobile_money' as const) : ('document' as const),
        topic,
        status: verdict.status,
      };
    });
    if (removed) await this.removeQuietly(removed);
    return { ...decided, restaurantId, ownerUserId: restaurant.ownerUserId, name: restaurant.name };
  }

  /** SPEC-022-07-SC04: a 5-minute link to one of the restaurant's papers (the route admits admins only). */
  documentLinkForReview(
    restaurantId: string,
    kind: PaperKind,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    return this.linkOf(restaurantId, kind);
  }

  /** SPEC-022-07 R3, SC02: approved — the restaurant becomes visible to customers. */
  approve(restaurantId: string, adminUserId: string): Promise<RestaurantDecision> {
    return this.decide(restaurantId, adminUserId, { status: 'approved' });
  }

  /** SPEC-022-07 R4: rejected with its reason (already checked: 10 to 500 characters). */
  reject(restaurantId: string, adminUserId: string, reason: string): Promise<RestaurantDecision> {
    return this.decide(restaurantId, adminUserId, { status: 'rejected', reason });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private async decide(
    restaurantId: string,
    adminUserId: string,
    decision: { status: 'approved' } | { status: 'rejected'; reason: string },
  ): Promise<RestaurantDecision> {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { name: true, ownerUserId: true },
    });
    if (!restaurant) throw notFound();
    if (restaurant.ownerUserId === adminUserId) throw ownRestaurant();
    await this.prisma.$transaction(async (tx) => {
      const application = await this.lockedRow(tx, restaurantId);
      const status = this.statusOf(application);
      if (status === 'to_complete') {
        throw new ConflictException({
          code: 'APPLICATION_NOT_SUBMITTED',
          message: "Ce dossier n'a pas encore été envoyé par le restaurant.",
        });
      }
      if (!applicationIsDecidable(status)) {
        throw new ConflictException({
          code: 'ALREADY_DECIDED',
          message: 'Ce dossier a déjà été décidé par un autre administrateur.',
        });
      }
      if (decision.status === 'approved') {
        // FEAT-022-Q18: the menu stays editable during the review, so the
        // four steps are checked again — never a visible restaurant with no dish.
        const { facts } = await this.facts(tx, restaurantId, application);
        const missing = missingRestaurantSteps(facts);
        if (missing.length > 0) {
          throw new ConflictException({
            code: 'APPLICATION_INCOMPLETE',
            message: 'Une étape du dossier ne tient plus : le restaurant doit la compléter.',
            details: { missing },
          });
        }
      }
      const now = new Date();
      await tx.restaurantApplication.update({
        where: { restaurantId },
        data: {
          status: decision.status,
          decidedAt: now,
          decidedBy: adminUserId,
          updatedAt: now,
          ...(decision.status === 'rejected' ? { rejectionReason: decision.reason } : {}),
        },
      });
      // Approved: visible to customers (R3). Rejected: back to a draft the owner corrects (R4).
      await tx.restaurant.update({
        where: { id: restaurantId },
        data: { status: decision.status === 'approved' ? 'active' : 'draft', updatedAt: now },
      });
      await this.audit.log(
        {
          actorUserId: adminUserId,
          action: decision.status === 'approved' ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED',
          entityType: 'restaurant_application',
          entityId: restaurantId,
          metadata: decision.status === 'rejected' ? { reason: decision.reason } : null,
        },
        tx,
      );
    });
    return {
      restaurantId,
      ownerUserId: restaurant.ownerUserId,
      name: restaurant.name,
      status: decision.status,
    };
  }

  private async scopedRestaurant(userId: string): Promise<string> {
    const restaurantId = await this.users.getRestaurantScope(userId);
    if (!restaurantId) throw notFound();
    return restaurantId;
  }

  private async lockedRow(
    tx: Prisma.TransactionClient,
    restaurantId: string,
  ): Promise<RestaurantApplication> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`restaurant-application:${restaurantId}`}))`;
    const application = await tx.restaurantApplication.findUnique({ where: { restaurantId } });
    if (!application) throw notFound();
    return application;
  }

  private async hasApplication(tx: Prisma.TransactionClient, restaurantId: string) {
    const found = await tx.restaurantApplication.findUnique({
      where: { restaurantId },
      select: { restaurantId: true },
    });
    return found !== null;
  }

  private async view(restaurantId: string): Promise<RestaurantApplicationView> {
    const application = await this.prisma.restaurantApplication.findUnique({
      where: { restaurantId },
    });
    if (!application) throw notFound();
    const [{ facts, restaurant, location }, pending] = await Promise.all([
      this.facts(this.prisma, restaurantId, application),
      pendingChangesOf(this.prisma, 'restaurant', restaurantId),
    ]);
    const done = restaurantStepsDone(facts);
    const status = this.statusOf(application);
    return {
      restaurantId,
      name: restaurant.name,
      status,
      steps: RESTAURANT_STEPS.map((step) => ({ step, done: done[step] })),
      location,
      photos: { logoUrl: restaurant.logoUrl, coverUrl: restaurant.coverUrl },
      papers: {
        registryNumber: application.registryNumber,
        registryPhoto: facts.hasRegistryPhoto,
        ownerIdPhoto: facts.hasOwnerIdPhoto,
      },
      mobileMoney: this.mobileMoneyOf(application, false),
      rejectionReason: status === 'rejected' ? application.rejectionReason : null,
      submittedAt: application.submittedAt?.toISOString() ?? null,
      pendingChanges: pending.map((change) => toPendingChange(change)),
    };
  }

  /** What the four steps need, read from the restaurant, its hours, its menu and its application. */
  private async facts(
    db: Prisma.TransactionClient | PrismaService,
    restaurantId: string,
    application: RestaurantApplication,
  ) {
    const [restaurant, points, hours, pricedProducts] = await Promise.all([
      db.restaurant.findUniqueOrThrow({
        where: { id: restaurantId },
        select: {
          name: true,
          ownerUserId: true,
          addressText: true,
          landmark: true,
          logoUrl: true,
          coverUrl: true,
          neighbourhoodId: true,
          neighbourhoodOther: true,
        },
      }),
      db.$queryRaw<Array<{ lat: number | null; lng: number | null }>>`
        SELECT ST_Y(geom::geometry) AS lat, ST_X(geom::geometry) AS lng
          FROM restaurants WHERE id = ${restaurantId}::uuid`,
      db.restaurantHours.count({ where: { restaurantId } }),
      db.product.count({ where: { restaurantId, priceMinor: { gt: 0n } } }),
    ]);
    const point = points[0];
    const location: RestaurantLocation = {
      lat: point?.lat ?? null,
      lng: point?.lng ?? null,
      addressText: restaurant.addressText,
      landmark: restaurant.landmark,
    };
    const facts: RestaurantApplicationFacts = {
      hasLocationPoint: location.lat !== null && location.lng !== null,
      addressText: restaurant.addressText,
      hasOpeningHours: hours > 0,
      pricedProducts,
      hasLogo: Boolean(restaurant.logoUrl),
      hasCover: Boolean(restaurant.coverUrl),
      registryNumber: application.registryNumber,
      hasRegistryPhoto: Boolean(application.registryPhotoKey),
      hasOwnerIdPhoto: Boolean(application.ownerIdPhotoKey),
      hasMobileMoney: Boolean(application.mobileMoneyProvider && application.mobileMoneyNumber),
    };
    return { facts, restaurant, location };
  }

  private async linkOf(
    restaurantId: string,
    kind: PaperKind,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const application = await this.prisma.restaurantApplication.findUnique({
      where: { restaurantId },
    });
    if (!application) throw notFound();
    const key = application[PAPER_COLUMN[kind]];
    if (!key) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Aucune photo envoyée.' });
    }
    return { url: await this.photos.link(key), expiresInSeconds: PRIVATE_LINK_SECONDS };
  }

  private mobileMoneyOf(
    application: RestaurantApplication,
    masked: boolean,
  ): { provider: MobileMoneyProvider; number: string } | null {
    const provider = application.mobileMoneyProvider;
    const number = application.mobileMoneyNumber;
    if ((provider !== 'airtel' && provider !== 'moov') || !number) return null;
    return { provider, number: masked ? maskNationalPhone(number, LAUNCH_MARKET) : number };
  }

  private statusOf(application: RestaurantApplication): ApplicationStatus {
    return isApplicationStatus(application.status) ? application.status : 'to_complete';
  }

  private async neighbourhoodNames(): Promise<Map<string, string>> {
    const all = await this.neighbourhoods.listAll(LAUNCH_MARKET.citySlug);
    return new Map(all.map((n) => [n.id, n.name]));
  }

  private async removeQuietly(key: string): Promise<void> {
    try {
      await this.photos.remove(key);
    } catch (err) {
      this.logger.warn(`photo not removed: ${err instanceof Error ? err.name : 'error'}`);
    }
  }
}

function neighbourhoodOf(
  restaurant: { neighbourhoodId: string | null; neighbourhoodOther: string | null },
  names: Map<string, string>,
): string | null {
  return (
    (restaurant.neighbourhoodId ? names.get(restaurant.neighbourhoodId) : null) ??
    restaurant.neighbourhoodOther ??
    null
  );
}

/** The key of one of DJAFAT's public photos from its address; `null` for any other address. */
function publicKeyOf(url: string | null): string | null {
  return url ? (PUBLIC_KEY_IN_URL.exec(url)?.[1] ?? null) : null;
}
