import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CourierDocumentKind } from '@djafat/core';
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
} from '../couriers/courier-application.service';
import {
  RestaurantApplicationService,
  type RestaurantApplicationQueueRow,
} from '../catalog/restaurant-application.service';
import { UsersService } from '../users/users.service';

export type ApplicationType = 'restaurant' | 'courier';

export interface ApplicationsQueue {
  readonly type: ApplicationType;
  /** SPEC-022-07 R1: both tabs show their number. */
  readonly counts: { readonly restaurant: number; readonly courier: number };
  readonly items: ReadonlyArray<RestaurantApplicationQueueRow | CourierApplicationQueueRow>;
}

/** What became of the decision's e-mail (R5: best effort, never undoes the decision). */
export type DecisionEmail = NoticeOutcome | 'no_address';

export interface DecisionResult {
  readonly id: string;
  readonly status: 'approved' | 'rejected';
  readonly email: DecisionEmail;
}

/**
 * FEAT-022 (SPEC-022-07): the admin's « Demandes à vérifier ». Composes the
 * owning modules — `couriers` and `catalog` hold the applications and their
 * state — and tells the applicant by e-mail once the decision is saved.
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
    const [restaurants, couriers] = await Promise.all([
      this.restaurants.listPendingForReview(),
      this.couriers.listPendingForReview(),
    ]);
    return {
      type,
      counts: { restaurant: restaurants.length, courier: couriers.length },
      items: type === 'restaurant' ? restaurants : couriers,
    };
  }

  courierDetail(userId: string): Promise<CourierApplicationReview> {
    return this.couriers.getForReview(userId);
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
  courierFileLink(userId: string, kind: CourierDocumentKind) {
    return this.couriers.documentLink(userId, kind);
  }

  private async tell(
    userId: string,
    notice:
      | Omit<Extract<AccountNotice, { kind: 'application_approved' }>, 'to'>
      | Omit<Extract<AccountNotice, { kind: 'application_rejected' }>, 'to'>,
  ): Promise<DecisionEmail> {
    const to = (await this.users.getById(userId))?.email;
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
