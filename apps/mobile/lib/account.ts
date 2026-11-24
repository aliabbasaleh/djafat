/**
 * Account screen of the app (FEAT-020, SPEC-020-08): the logic shared with
 * the site (`@djafat/sdk` account-form — same fields, rules, messages), plus
 * the app's own navigation rule. Pure.
 */
export {
  COMING_SOON,
  DIAL_CODE,
  RESEND_COOLDOWN_SECONDS,
  accountErrorMessage,
  channelButtons,
  emailSuggestionText,
  emailTypoCheck,
  fieldErrorsFromApi,
  maskEmail,
  phoneFieldShowsDialCode,
  phoneForSending,
  smsPhoneError,
  validateNewPassword,
  validateRegisterForm,
  type ChannelButton,
  type FieldErrors,
  type RegisterField,
  type RegisterFormValues,
} from '@djafat/sdk';

/** Where the app lands after logging in (unchanged rule, `login.tsx` before FEAT-020). */
export const HOME_ROUTE = '/(app)/restaurants';

/** `redirect` comes from the URL: only an in-app path is followed. */
export function afterLoginRoute(redirect: unknown): string {
  return typeof redirect === 'string' && redirect.startsWith('/(app)/') ? redirect : HOME_ROUTE;
}
