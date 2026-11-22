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

/** The URL parser silently drops tabs and line breaks and reads `\\` as `/`. */
function hasControlOrBackslash(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || char === '\\') return true;
  }
  return false;
}

const LOCAL_ORIGIN = 'http://djafat.invalid';

/**
 * Where to go after logging in (SPEC-020-10 R4): an internal path only — never
 * `//host` or a full URL, which would send the customer to another site. The
 * target is resolved the way the browser will resolve it (`/\t/evil.example`
 * becomes `https://evil.example/` once the tab is dropped), and only a path
 * that stays on our own origin is kept (review FEAT-020 #1).
 */
export function safeRedirect(target: string | null | undefined): string {
  if (!target || !target.startsWith('/') || hasControlOrBackslash(target)) return '/';
  let url: URL;
  try {
    url = new URL(target, LOCAL_ORIGIN);
  } catch {
    return '/';
  }
  if (url.origin !== LOCAL_ORIGIN) return '/';
  return url.pathname + url.search + url.hash;
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
