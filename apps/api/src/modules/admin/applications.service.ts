import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { isCourierDocumentKind, placeNameKey } from '@djafat/core';
import type { ChangeVerdict } from '../../common/onboarding/application-changes.repository';
import {
  ACCOUNT_NOTICE_PORT,
  type AccountNotice,
  type AccountNoticePort,
  type NoticeOutcome,
} from '../auth/account-notice.port';
import {
  CourierApplicationService,
  type CourierApplicationQueueRow,
  type CourierApplicationReview,
  type CourierChangeQueueRow,
} from '../couriers/courier-application.service';
import {
  RestaurantApplicationService,
  type RestaurantApplicationQueueRow,
  type RestaurantApplicationReview,
  type RestaurantChangeQueueRow,
} from '../catalog/restaurant-application.service';
import { UsersService } from '../users/users.service';

export type ApplicationType = 'restaurant' | 'courier';

export interface ApplicationsQueue {
  readonly type: ApplicationType;
  /** SPEC-022-07 R1: both tabs show their number — applications and changes (R6) to check. */
  readonly counts: { readonly restaurant: number; readonly courier: number };
  readonly items: ReadonlyArray<RestaurantApplicationQueueRow | CourierApplicationQueueRow>;
  /** R6: changes made after the approval, oldest first. */
  readonly changes: ReadonlyArray<RestaurantChangeQueueRow | CourierChangeQueueRow>;
}

/** What became of the decision's e-mail (R5: best effort, never undoes the decision). */
export type DecisionEmail = NoticeOutcome | 'no_address';

export interface DecisionResult {
  readonly id: string;
  readonly status: 'approved' | 'rejected';
  readonly email: DecisionEmail;
}

/** SPEC-022-09 R3: a name typed under « Autre », for an admin to add to the list. */
export interface TypedNeighbourhood {
  readonly name: string;
  readonly couriers: number;
  readonly restaurants: number;
}

/** R6: the decision on one change, and what became of its e-mail. */
export interface ChangeDecisionResult extends DecisionResult {
  readonly changeId: string;
}

const fileNotFound = () =>
  new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Aucune photo de ce type.' });

/**
 * FEAT-022 (SPEC-022-07): the admin's « Demandes à vérifier ». Composes the
 * owning modules — `couriers` and `catalog` hold the applications, their
 * changes after the approval (R6) and their state — and tells the applicant
 * by e-mail once the decision is saved.
 */
@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly couriers: CourierApplicationService,
    private readonly restaurants: RestaurantApplicationService,
    private readonly users: UsersService,
    @Inject(ACCOUNT_NOTICE_PORT) private readonly notices: AccountNoticePort,
  ) {}

  async queue(type: ApplicationType): Promise<ApplicationsQueue> {
    const [restaurants, couriers, restaurantChanges, courierChanges] = await Promise.all([
      this.restaurants.listPendingForReview(),
      this.couriers.listPendingForReview(),
      this.restaurants.listPendingChangesForReview(),
      this.couriers.listPendingChangesForReview(),
    ]);
    return {
      type,
      counts: {
        restaurant: restaurants.length + restaurantChanges.length,
        courier: couriers.length + courierChanges.length,
      },
      items: type === 'restaurant' ? restaurants : couriers,
      changes: type === 'restaurant' ? restaurantChanges : courierChanges,
    };
  }

  /**
   * SPEC-022-09 R3, SC02: the names typed under « Autre » by couriers and
   * restaurants, accents and case aside, most used first — except those the
   * list already has (`known`: the active neighbourhoods' names).
   */
  async typedNeighbourhoods(known: readonly string[]): Promise<TypedNeighbourhood[]> {
    const [couriers, restaurants] = await Promise.all([
      this.couriers.otherNeighbourhoodNames(),
      this.restaurants.otherNeighbourhoodNames(),
    ]);
    const listed = new Set(known.map((name) => placeNameKey(name)));
    const byKey = new Map<string, { name: string; couriers: number; restaurants: number }>();
    const add = (
      rows: Array<{ name: string; count: number }>,
      field: 'couriers' | 'restaurants',
    ) => {
      for (const row of rows) {
        const key = placeNameKey(row.name);
        if (listed.has(key)) continue;
        const entry = byKey.get(key) ?? { name: row.name, couriers: 0, restaurants: 0 };
        entry[field] += row.count;
        byKey.set(key, entry);
      }
    };
    add(couriers, 'couriers');
    add(restaurants, 'restaurants');
    return [...byKey.values()].sort(
      (a, b) =>
        b.couriers + b.restaurants - (a.couriers + a.restaurants) ||
        a.name.localeCompare(b.name, 'fr'),
    );
  }

  courierDetail(userId: string): Promise<CourierApplicationReview> {
    return this.couriers.getForReview(userId);
  }

  /** R2 (restaurant): what the admin checks; the papers open by signed link. */
  restaurantDetail(restaurantId: string): Promise<RestaurantApplicationReview> {
    return this.restaurants.getForReview(restaurantId);
  }

  /** R3, R5, SC02: approved — visible to customers — then « Votre restaurant est validé ». */
  async approveRestaurant(restaurantId: string, adminUserId: string): Promise<DecisionResult> {
    const decided = await this.restaurants.approve(restaurantId, adminUserId);
    const email = await this.tell(decided.ownerUserId, {
      kind: 'application_approved',
      applicant: { type: 'restaurant', restaurantName: decided.name },
    });
    return { id: restaurantId, status: 'approved', email };
  }

  /** R4, R5: rejected with its reason, which the e-mail carries. */
  async rejectRestaurant(
    restaurantId: string,
    adminUserId: string,
    reason: string,
  ): Promise<DecisionResult> {
    const decided = await this.restaurants.reject(restaurantId, adminUserId, reason);
    const email = await this.tell(decided.ownerUserId, {
      kind: 'application_rejected',
      applicant: { type: 'restaurant', restaurantName: decided.name },
      reason,
    });
    return { id: restaurantId, status: 'rejected', email };
  }

  /** SPEC-022-07-SC04 (restaurant): the RCCM or NIF, or the owner's ID, by a 5-minute link. */
  restaurantFileLink(restaurantId: string, kind: string) {
    if (kind !== 'registry' && kind !== 'owner_id') throw fileNotFound();
    return this.restaurants.documentLinkForReview(restaurantId, kind);
  }

  /** R6: the new paper of a pending change, by a 5-minute link. */
  changeFileLink(type: ApplicationType, id: string, changeId: string) {
    return type === 'restaurant'
      ? this.restaurants.changeLinkForReview(id, changeId)
      : this.couriers.changeLinkForReview(id, changeId);
  }

  /**
   * R6, R5: a change after the approval, accepted (the new number is paid
   * from now on) or refused with its reason; the applicant is told by e-mail.
   */
  async decideChange(
    type: ApplicationType,
    id: string,
    changeId: string,
    adminUserId: string,
    verdict: ChangeVerdict,
  ): Promise<ChangeDecisionResult> {
    const reason = verdict.status === 'rejected' ? { reason: verdict.reason } : {};
    if (type === 'restaurant') {
      const decided = await this.restaurants.decideChange(id, changeId, adminUserId, verdict);
      const email = await this.tell(decided.ownerUserId, {
        kind: 'change_decided',
        applicant: { type: 'restaurant', restaurantName: decided.name },
        topic: decided.topic,
        status: decided.status,
        ...reason,
      });
      return { id, changeId, status: decided.status, email };
    }
    const decided = await this.couriers.decideChange(id, changeId, adminUserId, verdict);
    const email = await this.tell(id, {
      kind: 'change_decided',
      applicant: { type: 'courier' },
      topic: decided.topic,
      status: decided.status,
      ...reason,
    });
    return { id, changeId, status: decided.status, email };
  }

  /** R3, R5: approved, then « Votre compte livreur DJAFAT est validé ». */
  async approveCourier(userId: string, adminUserId: string): Promise<DecisionResult> {
    await this.couriers.approve(userId, adminUserId);
    const email = await this.tell(userId, {
      kind: 'application_approved',
      applicant: { type: 'courier' },
    });
    return { id: userId, status: 'approved', email };
  }

  /** R4, R5: rejected with its reason, which the e-mail carries. */
  async rejectCourier(
    userId: string,
    adminUserId: string,
    reason: string,
  ): Promise<DecisionResult> {
    await this.couriers.reject(userId, adminUserId, reason);
    const email = await this.tell(userId, {
      kind: 'application_rejected',
      applicant: { type: 'courier' },
      reason,
    });
    return { id: userId, status: 'rejected', email };
  }

  /** SPEC-022-07-SC04: a 5-minute link to one photo (the route admits admins only). */
  courierFileLink(userId: string, kind: string) {
    if (!isCourierDocumentKind(kind)) throw fileNotFound();
    return this.couriers.documentLink(userId, kind);
  }

  private async tell(
    userId: string | null,
    notice:
      | Omit<Extract<AccountNotice, { kind: 'application_approved' }>, 'to'>
      | Omit<Extract<AccountNotice, { kind: 'application_rejected' }>, 'to'>
      | Omit<Extract<AccountNotice, { kind: 'change_decided' }>, 'to'>,
  ): Promise<DecisionEmail> {
    const to = userId ? (await this.users.getById(userId))?.email : null;
    if (!to) {
      this.logger.warn(`Decision "${notice.kind}" saved; no e-mail address to tell the applicant`);
      return 'no_address';
    }
    try {
      const outcome = await this.notices.send({ ...notice, to } as AccountNotice);
      if (outcome !== 'sent')
        this.logger.warn(`Decision "${notice.kind}" saved; e-mail ${outcome}`);
      return outcome;
    } catch (err) {
      this.logger.error(
        `Decision "${notice.kind}" saved; e-mail failed: ${err instanceof Error ? err.message : 'error'}`,
      );
      return 'failed';
    }
  }
}
