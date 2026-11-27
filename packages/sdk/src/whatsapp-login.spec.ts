import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WhatsappStatus } from './auth.js';
import { channelButtons } from './account-form.js';
import { ApiClientError } from './http.js';
import {
  WHATSAPP_TEXT,
  afterSignup,
  notConfirmedActions,
  phoneFieldValue,
  showsWhatsappConfirmStep,
  waitForWhatsapp,
  whatsappDesktopHint,
  whatsappForeignIntro,
  whatsappNumberText,
  whatsappSignedIn,
  whatsappWaitingText,
  whatsappWrongNumberText,
} from './whatsapp-login.js';

// FEAT-023 — docs/features/FEAT-023-whatsapp-gratuit (SPEC-023-05 to 07), against
// FEAT-023-VIS02 and VIS03. Numbers are fictitious.

const ON = [{ id: 'whatsapp', available: true }];
const OFF = [{ id: 'whatsapp', available: false }];

afterEach(() => {
  vi.useRealTimers();
});

describe('SPEC-023-05 — the WhatsApp view of the site and the customer app', () => {
  // SPEC-023-05-SC01
  it('SPEC-023-05-SC01 — the words of FEAT-023-VIS02, in its order; DJAFAT’s number written; 5 minutes', () => {
    const now = Date.parse('2026-11-25T10:00:00Z');
    const expiresAt = new Date(now + 300_000).toISOString();
    expect([
      WHATSAPP_TEXT.loginTitle,
      WHATSAPP_TEXT.step1,
      WHATSAPP_TEXT.step2,
      WHATSAPP_TEXT.warning,
      WHATSAPP_TEXT.open,
      whatsappDesktopHint('+23566868973'),
      whatsappWaitingText(expiresAt, now),
      WHATSAPP_TEXT.otherWay,
    ]).toEqual([
      'Se connecter avec WhatsApp',
      "1. Appuyez sur le bouton : WhatsApp s'ouvre avec ce message déjà écrit :",
      '2. Envoyez-le, puis revenez ici.',
      "N'envoyez ce code que pour vous connecter vous-même. Si quelqu'un vous demande de l'envoyer, refusez : il veut entrer dans votre compte.",
      'Ouvrir WhatsApp',
      'Sur un ordinateur : envoyez ce message depuis votre téléphone au numéro WhatsApp de DJAFAT, +235 66 86 89 73.',
      '⏳ En attente de votre message… (valable 5 min)',
      '← Autre moyen de connexion',
    ]);
    // The minutes left, never 0 while it waits.
    expect(whatsappWaitingText(expiresAt, now + 150_000)).toBe(
      '⏳ En attente de votre message… (valable 3 min)',
    );
    expect(whatsappWaitingText(expiresAt, now + 299_000)).toBe(
      '⏳ En attente de votre message… (valable 1 min)',
    );
  });

  // SPEC-023-05-SC02
  it('SPEC-023-05-SC02 — asks every 2 s, at once when poked, keeps going after a network failure, stops at the outcome', async () => {
    vi.useFakeTimers();
    const answers: Array<WhatsappStatus | Error> = [
      { status: 'waiting', expiresAt: '2026-11-25T10:05:00Z' },
      new ApiClientError({ status: 0, code: 'NETWORK', message: 'offline' }),
      { status: 'waiting', expiresAt: '2026-11-25T10:05:00Z' },
      { status: 'not_confirmed', phone: '+33612345678' },
    ];
    const ask = vi.fn(async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next ?? { status: 'expired' as const };
    });
    const onOutcome = vi.fn();
    const onError = vi.fn();
    const wait = waitForWhatsapp({ ask, onOutcome, onError });

    expect(ask).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ask).toHaveBeenCalledTimes(1); // waiting
    await vi.advanceTimersByTimeAsync(2000);
    expect(ask).toHaveBeenCalledTimes(2); // network failure: not stopped
    wait.poke(); // back from WhatsApp: at once
    await vi.advanceTimersByTimeAsync(0);
    expect(ask).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ask).toHaveBeenCalledTimes(4);
    expect(onOutcome).toHaveBeenCalledWith({ status: 'not_confirmed', phone: '+33612345678' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(ask).toHaveBeenCalledTimes(4); // stopped
    expect(onError).not.toHaveBeenCalled();
  });

  it('SPEC-023-05 « Erreurs » — a refusal of the server stops the wait and is shown; leaving the view stops it too', async () => {
    vi.useFakeTimers();
    const refused = new ApiClientError({
      status: 403,
      code: 'ACCOUNT_INACTIVE',
      message: 'Account is suspended.',
    });
    const onError = vi.fn();
    const ask = vi.fn(async () => {
      throw refused;
    });
    waitForWhatsapp({ ask, onOutcome: vi.fn(), onError });
    await vi.advanceTimersByTimeAsync(6000);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(refused);

    const quiet = vi.fn(
      async (): Promise<WhatsappStatus> => ({ status: 'waiting', expiresAt: 'x' }),
    );
    const wait = waitForWhatsapp({ ask: quiet, onOutcome: vi.fn(), onError: vi.fn() });
    wait.stop();
    await vi.advanceTimersByTimeAsync(6000);
    expect(quiet).not.toHaveBeenCalled();
  });

  // SPEC-023-05-SC03
  it('SPEC-023-05-SC03 — « confirmed on no account »: two buttons on the site, the number filled in « Créer un compte »', () => {
    expect(WHATSAPP_TEXT.notConfirmed).toBe("Ce numéro n'est confirmé sur aucun compte");
    expect(notConfirmedActions('customer')).toEqual(['create_account', 'email_login']);
    expect([WHATSAPP_TEXT.createAccount, WHATSAPP_TEXT.emailLogin]).toEqual([
      'Créer un compte',
      'Se connecter par e-mail',
    ]);
    expect(phoneFieldValue('+33612345678')).toBe('+33 6 12 34 56 78');
    expect(phoneFieldValue('+23566123456')).toBe('66 12 34 56');
  });

  // SPEC-023-05-SC04
  it('SPEC-023-05-SC04 — expired: « Ce code a expiré. » and « Nouveau code »', () => {
    expect([WHATSAPP_TEXT.expired, WHATSAPP_TEXT.newCode]).toEqual([
      'Ce code a expiré.',
      'Nouveau code',
    ]);
  });

  // SPEC-023-05-SC05
  it('SPEC-023-05-SC05 — a new device: the message came from another number', () => {
    expect(whatsappWrongNumberText()).toBe(
      'Ce message ne vient pas du numéro de votre compte. Envoyez-le depuis ce numéro.',
    );
  });

  // SPEC-023-05-SC06
  it('SPEC-023-05-SC06 — WhatsApp off: greyed « Bientôt disponible », the button asks for nothing', () => {
    const buttons = channelButtons([
      { id: 'whatsapp', available: false },
      { id: 'sms', available: false },
      { id: 'email', available: true },
    ]);
    expect(buttons.find((b) => b.id === 'whatsapp')).toEqual({
      id: 'whatsapp',
      icon: '🟢',
      label: 'WhatsApp',
      enabled: false,
      note: 'Bientôt disponible',
    });
  });

  it('a signed-in answer gives the session as every login does', () => {
    const session = {
      access: 'a',
      accessExpiresAt: 'x',
      refresh: 'r',
      refreshExpiresAt: 'y',
      user: {
        id: 'u-1',
        phone: '+23566123456',
        email: null,
        emailVerified: false,
        phoneVerified: true,
        hasPassword: false,
        fullName: null,
        roles: ['customer'],
      },
    };
    expect(whatsappSignedIn({ status: 'signed_in', ...session })).toEqual(session);
  });
});

describe('SPEC-023-06 — confirming a number by WhatsApp', () => {
  // SPEC-023-06-SC01
  it('SPEC-023-06-SC01 — « Mon profil »: the confirmation’s title and second step', () => {
    expect(WHATSAPP_TEXT.confirmTitle).toBe('Confirmer mon numéro par WhatsApp');
    expect(WHATSAPP_TEXT.step2FromNumber).toBe('2. Envoyez-le depuis ce numéro, puis revenez ici.');
  });

  // SPEC-023-06-SC02
  it('SPEC-023-06-SC02 — another number: the account’s number is named', () => {
    expect(whatsappWrongNumberText('+33612345678')).toBe(
      'Ce message ne vient pas du numéro de votre compte (+33 6 12 34 56 78). Envoyez-le depuis ce numéro.',
    );
  });

  // SPEC-023-06-SC03
  it('SPEC-023-06-SC03 — a customer with a foreign number: the step, then back to the page', () => {
    const phone = '+33612345678';
    expect(afterSignup({ type: 'customer', phone, methods: ON })).toBe('whatsapp_confirm');
    expect([
      WHATSAPP_TEXT.accountCreated,
      whatsappForeignIntro(phone),
      WHATSAPP_TEXT.later,
    ]).toEqual([
      '✅ Votre compte est créé.',
      'Votre numéro +33 6 12 34 56 78 ne reçoit pas de SMS. Confirmez-le par WhatsApp pour vous connecter ensuite par WhatsApp.',
      'Plus tard',
    ]);
    expect(afterSignup({ type: 'customer', phone, methods: ON, whatsappStepDone: true })).toBe(
      'leave',
    );
  });

  // SPEC-023-06-SC04
  it('SPEC-023-06-SC04 — « Plus tard » after a courier’s sign-up: the courier’s « et maintenant ? »', () => {
    const courier = { type: 'courier' as const, phone: '+33612345678', methods: ON };
    expect(afterSignup(courier)).toBe('whatsapp_confirm');
    expect(afterSignup({ ...courier, whatsappStepDone: true })).toBe('what_next');
  });

  // SPEC-023-06-SC05
  it('SPEC-023-06-SC05 — a Chad number, or WhatsApp off: no step', () => {
    expect(showsWhatsappConfirmStep('+23566123456', ON)).toBe(false);
    expect(showsWhatsappConfirmStep('+33612345678', OFF)).toBe(false);
    expect(showsWhatsappConfirmStep('+33612345678', null)).toBe(false);
    expect(afterSignup({ type: 'customer', phone: '+23566123456', methods: ON })).toBe('leave');
    expect(afterSignup({ type: 'restaurant', phone: '+33612345678', methods: OFF })).toBe(
      'what_next',
    );
  });
});

describe('SPEC-023-07 — the team apps', () => {
  // SPEC-023-07-SC03
  it('SPEC-023-07-SC03 — « confirmed on no account »: « Se connecter par e-mail » only', () => {
    expect(notConfirmedActions('team')).toEqual(['email_login']);
  });

  // SPEC-023-07-SC04
  it('SPEC-023-07-SC04 — the same view as the site (SPEC-023-05 R1)', () => {
    expect(whatsappNumberText('+23566868973')).toBe('+235 66 86 89 73');
    expect(whatsappNumberText('+237699112233')).toBe('+237699112233'); // other countries as given
    expect(WHATSAPP_TEXT.loginTitle).toBe('Se connecter avec WhatsApp');
  });
});
