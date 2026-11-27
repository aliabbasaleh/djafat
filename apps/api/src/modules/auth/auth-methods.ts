import type { ApiEnv } from '@djafat/config';

/**
 * Login methods registry (FEAT-008, SPEC-008-01). The app shows only what is
 * available on this deployment. A new method (Facebook, Apple, Google…) is a
 * new entry here plus its own flow; the response shape does not change.
 * Order = preference in Chad: WhatsApp (free for DJAFAT), SMS, email.
 */
export type AuthMethodId = 'whatsapp' | 'sms' | 'email';

export interface AuthMethod {
  readonly id: AuthMethodId;
  readonly available: boolean;
  /** WhatsApp only: opens DJAFAT's chat with the login text pre-filled. */
  readonly link?: string;
}

/** The text the customer sends; the inbound webhook looks for "code" in it. */
export const WHATSAPP_LOGIN_TEXT = 'Code DJAFAT';

type MethodsEnv = Pick<
  ApiEnv,
  'NODE_ENV' | 'SMS_PROVIDER' | 'EMAIL_PROVIDER' | 'WHATSAPP_PROVIDER' | 'WHATSAPP_BUSINESS_NUMBER'
>;

/**
 * The methods of this deployment, read through its configuration — one place
 * for the route, the new-device challenge and the SMS refusal (FEAT-024).
 */
export function authMethodsFrom(
  get: <K extends keyof MethodsEnv>(key: K) => MethodsEnv[K],
): AuthMethod[] {
  return listAuthMethods({
    NODE_ENV: get('NODE_ENV'),
    SMS_PROVIDER: get('SMS_PROVIDER'),
    EMAIL_PROVIDER: get('EMAIL_PROVIDER'),
    WHATSAPP_PROVIDER: get('WHATSAPP_PROVIDER'),
    WHATSAPP_BUSINESS_NUMBER: get('WHATSAPP_BUSINESS_NUMBER'),
  });
}

export function listAuthMethods(env: MethodsEnv): AuthMethod[] {
  const devMock = env.NODE_ENV !== 'production';
  const whatsapp =
    Boolean(env.WHATSAPP_BUSINESS_NUMBER) && (env.WHATSAPP_PROVIDER === 'cloud' || devMock);
  return [
    whatsapp && env.WHATSAPP_BUSINESS_NUMBER
      ? {
          id: 'whatsapp',
          available: true,
          link: `https://wa.me/${env.WHATSAPP_BUSINESS_NUMBER.slice(1)}?text=${encodeURIComponent(WHATSAPP_LOGIN_TEXT)}`,
        }
      : { id: 'whatsapp', available: false },
    {
      id: 'sms',
      available: env.SMS_PROVIDER === 'http' || (env.SMS_PROVIDER === 'mock' && devMock),
    },
    { id: 'email', available: env.EMAIL_PROVIDER === 'smtp' || devMock },
  ];
}
