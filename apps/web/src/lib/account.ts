/**
 * Account screens of the site (FEAT-020): the logic shared with the mobile
 * app (`@djafat/sdk` account-form — same fields, rules, messages), plus the
 * site's own navigation rules. Pure.
 */
export {
  COMING_SOON,
  RESEND_COOLDOWN_SECONDS,
  accountErrorMessage,
  channelButtons,
  fieldErrorsFromApi,
  maskEmail,
  passwordSectionMode,
  phoneSectionState,
  validateNewPassword,
  validateRegisterForm,
  type ChannelButton,
  type FieldErrors,
  type PasswordSectionMode,
  type PhoneSectionState,
  type RegisterField,
  type RegisterFormValues,
} from '@djafat/sdk';

/** The account page (FEAT-020-Q04). */
export const COMPTE_PATH = '/compte';

/**
 * Where to go after logging in (SPEC-020-10 R4): an internal path only — never
 * `//host` or a full URL, which would send the customer to another site.
 */
export function safeRedirect(target: string | null | undefined): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) {
    return '/';
  }
  return target;
}

/** `/compte`, keeping a safe `redirect` (SPEC-020-07: the old `/connexion?redirect=X`). */
export function compteHref(redirect: string | null | undefined, tab?: 'inscription'): string {
  const params = new URLSearchParams();
  if (tab) params.set('onglet', tab);
  const safe = safeRedirect(redirect);
  if (safe !== '/') params.set('redirect', safe);
  const query = params.toString();
  return query ? `${COMPTE_PATH}?${query}` : COMPTE_PATH;
}
