import { LAUNCH_PHONE_MARKET, phoneKind } from '@djafat/core';
import type { SignedIn, WhatsappStatus } from './auth.js';
import { ApiClientError } from './http.js';

/**
 * Client logic of the free WhatsApp login (FEAT-023, SPEC-023-05 to 07): the
 * texts of FEAT-023-VIS02 and VIS03, the number written for people, which
 * buttons an outcome offers, and the wait — shared by the site, the customer
 * app and the three team apps. No UI and no storage here.
 */

/** FEAT-023-VIS02 and VIS03 — the words of the WhatsApp view (SPEC-023-05 R1, SPEC-023-06 R1-R3). */
export const WHATSAPP_TEXT = {
  loginTitle: 'Se connecter avec WhatsApp',
  confirmTitle: 'Confirmer mon numéro par WhatsApp',
  step1: "1. Appuyez sur le bouton : WhatsApp s'ouvre avec ce message déjà écrit :",
  step2: '2. Envoyez-le, puis revenez ici.',
  step2FromNumber: '2. Envoyez-le depuis ce numéro, puis revenez ici.',
  warning:
    "N'envoyez ce code que pour vous connecter vous-même. Si quelqu'un vous demande de l'envoyer, refusez : il veut entrer dans votre compte.",
  open: 'Ouvrir WhatsApp',
  otherWay: '← Autre moyen de connexion',
  back: 'Retour',
  later: 'Plus tard',
  newCode: 'Nouveau code',
  notConfirmed: "Ce numéro n'est confirmé sur aucun compte",
  createAccount: 'Créer un compte',
  emailLogin: 'Se connecter par e-mail',
  expired: 'Ce code a expiré.',
  accountCreated: 'Votre compte est créé.',
  confirmed: 'Numéro confirmé : vous pouvez vous connecter par WhatsApp.',
  continue: 'Continuer',
} as const;

/**
 * The pictures of FEAT-023-VIS02 and VIS03, drawn by the views as decoration
 * next to their text, hidden from screen readers (SPEC-023-05 R9): the texts
 * above, and the ones a live region announces, carry none.
 */
export const WHATSAPP_ICON = {
  waiting: '⏳',
  done: '✅',
  warning: '⚠️',
  open: '🟢',
} as const;

/**
 * A number written for people: `+235 66 86 89 73` (Chad), `+33 6 12 34 56 78`
 * (France); any other number stays as the API gives it (E.164).
 */
export function whatsappNumberText(e164: string): string {
  const chad = /^\+235(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  if (chad) return `+235 ${chad.slice(1).join(' ')}`;
  const france = /^\+33(\d)(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  if (france) return `+33 ${france.slice(1).join(' ')}`;
  return e164;
}

/** SPEC-023-05 R1: how to send it from a computer, with DJAFAT's number. */
export function whatsappDesktopHint(businessNumber: string): string {
  return `Sur un ordinateur : envoyez ce message depuis votre téléphone au numéro WhatsApp de DJAFAT, ${whatsappNumberText(businessNumber)}.`;
}

/**
 * SPEC-023-05 R1: « En attente de votre message… (valable 5 min) » — the
 * minutes left, rounded (a few seconds of clock difference with the server
 * never show « 6 min »), at least 1. The view draws ⏳ in front, as decoration.
 */
export function whatsappWaitingText(expiresAt: string, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.round((Date.parse(expiresAt) - now) / 60_000));
  return `En attente de votre message… (valable ${minutes} min)`;
}

/**
 * SPEC-023-05 R6, SPEC-023-06 R2: the message came from another number than
 * the account's — named when the screen knows it.
 */
export function whatsappWrongNumberText(accountPhone?: string | null): string {
  const named = accountPhone ? ` (${whatsappNumberText(accountPhone)})` : '';
  return `Ce message ne vient pas du numéro de votre compte${named}. Envoyez-le depuis ce numéro.`;
}

/** FEAT-023-VIS03: why a foreign number is asked to confirm by WhatsApp. */
export function whatsappForeignIntro(phone: string): string {
  return `Votre numéro ${whatsappNumberText(phone)} ne reçoit pas de SMS. Confirmez-le par WhatsApp pour vous connecter ensuite par WhatsApp.`;
}

/**
 * SPEC-023-06 R3, R5: the step « Confirmer mon numéro par WhatsApp » right
 * after the sign-up — a foreign number only, and only when WhatsApp is in
 * service (`GET /auth/methods`).
 */
export function showsWhatsappConfirmStep(
  phone: string,
  methods: ReadonlyArray<{ id: string; available: boolean }> | null | undefined,
): boolean {
  const whatsapp = methods?.some((m) => m.id === 'whatsapp' && m.available) ?? false;
  return whatsapp && phoneKind(phone, LAUNCH_PHONE_MARKET) === 'foreign';
}

/** What follows the right e-mail code of a sign-up (SPEC-023-06 R3-R5). */
export type AfterSignup = 'whatsapp_confirm' | 'leave' | 'what_next';

/**
 * SPEC-023-06 R3-R5: a foreign number, WhatsApp in service, and the step not
 * done yet → « Confirmer mon numéro par WhatsApp »; then (confirmed or « Plus
 * tard ») the end of today's sign-up — a customer leaves for the page they
 * came from, a courier or a restaurant sees « et maintenant ? ».
 */
export function afterSignup(input: {
  readonly type: 'customer' | 'courier' | 'restaurant';
  readonly phone: string;
  readonly methods: ReadonlyArray<{ id: string; available: boolean }> | null | undefined;
  readonly whatsappStepDone?: boolean;
}): AfterSignup {
  if (!input.whatsappStepDone && showsWhatsappConfirmStep(input.phone, input.methods)) {
    return 'whatsapp_confirm';
  }
  return input.type === 'customer' ? 'leave' : 'what_next';
}

/**
 * SPEC-023-05 R4: the number that wrote, as « Créer un compte » fills its
 * field — a Chad number as typed in Chad (`66 12 34 56`, « +235 » shown in
 * front), any other with its country code.
 */
export function phoneFieldValue(e164: string): string {
  const chad = /^\+235(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(e164);
  return chad ? chad.slice(1).join(' ') : whatsappNumberText(e164);
}

/** What an outcome's buttons do, in their order. */
export type WhatsappAction = 'create_account' | 'email_login' | 'new_code';

/** What a screen shows for an outcome that opens nothing: the sentence, then the buttons. */
export interface WhatsappOutcomeView {
  readonly message: string;
  readonly actions: readonly WhatsappAction[];
}

/**
 * The outcomes that open nothing, as every WhatsApp view shows them
 * (SPEC-023-05 R4-R6, SPEC-023-06 R2, SPEC-023-07 R3, R4):
 * - « Ce numéro n'est confirmé sur aucun compte » — the site and the customer
 *   app offer « Créer un compte » then « Se connecter par e-mail »; a team app
 *   only the second (a team account is not created there, FEAT-023-Q16);
 * - another number than the account's — said, with the account's number when
 *   known, then « Nouveau code »;
 * - expired — « Ce code a expiré. » then « Nouveau code ».
 */
export function whatsappOutcomeView(
  status: 'not_confirmed' | 'wrong_number' | 'expired',
  options: { readonly app: 'customer' | 'team'; readonly accountPhone?: string | null },
): WhatsappOutcomeView {
  if (status === 'not_confirmed') {
    return {
      message: WHATSAPP_TEXT.notConfirmed,
      actions: options.app === 'customer' ? ['create_account', 'email_login'] : ['email_login'],
    };
  }
  if (status === 'wrong_number') {
    return { message: whatsappWrongNumberText(options.accountPhone), actions: ['new_code'] };
  }
  return { message: WHATSAPP_TEXT.expired, actions: ['new_code'] };
}

/** The label of an outcome's button. */
export function whatsappActionLabel(action: WhatsappAction): string {
  return {
    create_account: WHATSAPP_TEXT.createAccount,
    email_login: WHATSAPP_TEXT.emailLogin,
    new_code: WHATSAPP_TEXT.newCode,
  }[action];
}

/** The session of a `signed_in` answer, as every login gives it (without `status`). */
export function whatsappSignedIn(answer: { readonly status: 'signed_in' } & SignedIn): SignedIn {
  const { status: _status, ...signedIn } = answer;
  return signedIn;
}

/** Every answer but « waiting ». */
export type WhatsappOutcome = Exclude<WhatsappStatus, { readonly status: 'waiting' }>;

/** What a screen can do with a running wait. */
export interface WhatsappWait {
  /** Ask now — the screen is visible again, back from WhatsApp (SPEC-023-05 R2, R8). */
  poke(): void;
  /** Leave the view: no more asking. */
  stop(): void;
}

export interface WhatsappWaitOptions {
  /** `api.auth.whatsappStatus` with this screen's token. */
  readonly ask: () => Promise<WhatsappStatus>;
  readonly onOutcome: (outcome: WhatsappOutcome) => void;
  /** A refusal of the server (403, 422…): the wait stops; the screen shows why. */
  readonly onError: (err: unknown) => void;
  /** 2 s (SPEC-023-05 R2, FEAT-023-Q11). */
  readonly intervalMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** A network failure (no answer at all) is retried; an answer of the server is not. */
function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof ApiClientError) || err.code === 'NETWORK' || err.status >= 500;
}

/**
 * SPEC-023-05 R2: asks where the code stands every 2 seconds, and at once on
 * `poke()`; stops at the first outcome, at a refusal, or on `stop()`. A
 * network failure does not stop it. One question at a time.
 */
export function waitForWhatsapp(options: WhatsappWaitOptions): WhatsappWait {
  const interval = options.intervalMs ?? 2000;
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let stopped = false;
  let asking = false;
  let timer: unknown = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimer(() => void tick(), interval);
  };

  async function tick(): Promise<void> {
    if (stopped || asking) return;
    timer = null;
    asking = true;
    try {
      const answer = await options.ask();
      if (stopped) return;
      if (answer.status === 'waiting') {
        schedule();
        return;
      }
      stopped = true;
      options.onOutcome(answer);
    } catch (err) {
      if (stopped) return;
      if (isNetworkFailure(err)) {
        schedule();
        return;
      }
      stopped = true;
      options.onError(err);
    } finally {
      asking = false;
    }
  }

  schedule();
  return {
    poke() {
      if (stopped || asking) return;
      if (timer !== null) clearTimer(timer);
      timer = null;
      void tick();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
