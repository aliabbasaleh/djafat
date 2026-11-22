/**
 * Account emails that carry no code (FEAT-020, SPEC-020-01 R6): "you already
 * have an account" (sent instead of a registration code, SPEC-020-03 R3) and
 * "your password was changed" (SPEC-020-05). Chosen by `EMAIL_PROVIDER`, like
 * the code transport. Best effort: a provider never throws, so a notice that
 * cannot leave never fails the request that sends it.
 */
export type AccountNotice =
  | { readonly kind: 'already_registered'; readonly to: string }
  | { readonly kind: 'password_changed'; readonly to: string; readonly at: Date };

export interface AccountNoticePort {
  send(notice: AccountNotice): Promise<void>;
}

export const ACCOUNT_NOTICE_PORT = Symbol('ACCOUNT_NOTICE_PORT');
