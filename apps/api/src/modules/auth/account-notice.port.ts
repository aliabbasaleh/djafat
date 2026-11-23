/**
 * Account emails that carry no code (FEAT-020, SPEC-020-01 R6): "you already
 * have an account" (sent instead of a registration code, SPEC-020-03 R3),
 * "your password was changed" (SPEC-020-05) and, since FEAT-022, DJAFAT's
 * decision on an application (SPEC-022-07 R5). Chosen by `EMAIL_PROVIDER`, like
 * the code transport. Best effort: a provider never throws, so a notice that
 * cannot leave never fails the request that sends it.
 */
export type AccountNotice =
  | { readonly kind: 'already_registered'; readonly to: string }
  | { readonly kind: 'password_changed'; readonly to: string; readonly at: Date }
  /** FEAT-020 SPEC-020-12: sent to the OLD address; `newAddress` is already masked. */
  | {
      readonly kind: 'email_changed';
      readonly to: string;
      readonly newAddress: string;
      readonly at: Date;
    }
  /** FEAT-022 SPEC-022-07 R5: DJAFAT validated an application. */
  | { readonly kind: 'application_approved'; readonly to: string; readonly applicant: Applicant }
  /** FEAT-022 SPEC-022-07 R4, R5: DJAFAT refused it, and says why. */
  | {
      readonly kind: 'application_rejected';
      readonly to: string;
      readonly applicant: Applicant;
      readonly reason: string;
    };

/** Who applied (FEAT-022): a courier, or a restaurant's owner for that restaurant. */
export type Applicant =
  | { readonly type: 'courier' }
  | { readonly type: 'restaurant'; readonly restaurantName: string };

/**
 * What became of a notice: accepted by the mail server, not possible on this
 * deployment (the mock in production), or failed. A provider never throws; a
 * caller that must fail like a code transport maps it (review FEAT-020 #3).
 */
export type NoticeOutcome = 'sent' | 'unavailable' | 'failed';

export interface AccountNoticePort {
  send(notice: AccountNotice): Promise<NoticeOutcome>;
}

export const ACCOUNT_NOTICE_PORT = Symbol('ACCOUNT_NOTICE_PORT');
