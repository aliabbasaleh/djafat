'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ApiClientError,
  WHATSAPP_ICON,
  WHATSAPP_TEXT,
  waitForWhatsapp,
  whatsappActionLabel,
  whatsappDesktopHint,
  whatsappOutcomeView,
  whatsappSignedIn,
  whatsappWaitingText,
  type SignedIn,
  type WhatsappAction,
  type WhatsappCode,
  type WhatsappOutcomeView,
} from '@djafat/sdk';
import { VisuallyHidden, cx } from '@djafat/ui';
import { Alert, Button, Checkbox } from '@/components/ui-client';
import { api } from '@/lib/api';
import { accountErrorMessage } from '@/lib/account';
import styles from './account.module.css';

interface WhatsappStepProps {
  /** A login (the warning shows) or the confirmation of the account's number. */
  readonly purpose: 'login' | 'confirm';
  /** Asks the API for a code to send: `startWhatsapp` or `startPhoneWhatsapp`. */
  readonly start: () => Promise<WhatsappCode>;
  /** Shown above the title (FEAT-023-VIS03: « ✅ Votre compte est créé. »). */
  readonly before?: ReactNode;
  /** Shown under the title. */
  readonly intro?: ReactNode;
  /** New device: « Se souvenir de cet appareil », sent with each question. */
  readonly remember?: { readonly checked: boolean; readonly onChange: (v: boolean) => void };
  /** The account's number, named when the message came from another one. */
  readonly accountPhone?: string | null;
  readonly onSignedIn?: (signedIn: SignedIn) => void;
  /** The number is confirmed — also when the server says it already was (409). */
  readonly onConfirmed?: () => void;
  /** FEAT-023-VIS03 « Ensuite »: say « Numéro confirmé » and wait for « Continuer ». */
  readonly confirmedContinue?: boolean;
  /** « Créer un compte » with the number that wrote (SPEC-023-05 R4). */
  readonly onCreateAccount?: (phone: string) => void;
  /** « Se connecter par e-mail ». */
  readonly onEmailLogin?: () => void;
  readonly backLabel?: string;
  /** « Plus tard » of the sign-up step is a secondary button (SPEC-023-06 « UI »). */
  readonly backVariant?: 'ghost' | 'secondary';
  readonly onBack: () => void;
}

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'code'; readonly code: WhatsappCode }
  | { readonly kind: 'outcome'; readonly view: WhatsappOutcomeView; readonly phone?: string }
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'error'; readonly message: string };

/** The digits read one by one by a screen reader (SPEC-023-05 R9). */
const spelled = (text: string, code: string) => text.replace(code, code.split('').join(' '));

/**
 * The free WhatsApp view (FEAT-023-VIS02, VIS03; SPEC-023-05, SPEC-023-06): the
 * message already written with its code, « Ouvrir WhatsApp », how to send it
 * from a computer, then the wait — every 2 s and at once when the page is
 * visible again — and its outcome. One live region says the wait and the
 * outcome. DJAFAT sends nothing on WhatsApp.
 */
export function WhatsappStep(props: WhatsappStepProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const title = useRef<HTMLHeadingElement>(null);
  const rememberRef = useRef(props.remember?.checked ?? false);
  rememberRef.current = props.remember?.checked ?? false;
  // The latest callbacks, without restarting the code or the wait when the parent renders.
  const handlers = useRef(props);
  handlers.current = props;

  const confirmed = useCallback(() => {
    if (handlers.current.confirmedContinue) setShown({ kind: 'confirmed' });
    else handlers.current.onConfirmed?.();
  }, []);

  const ask = useCallback(() => {
    setShown({ kind: 'loading' });
    handlers.current
      .start()
      .then((code) => {
        setNow(Date.now()); // the validity counts from the code's arrival
        setShown({ kind: 'code', code });
      })
      .catch((err: unknown) => {
        // SPEC-023-06 « Erreurs »: already confirmed elsewhere — the profile is read again.
        if (err instanceof ApiClientError && err.code === 'PHONE_ALREADY_CONFIRMED') {
          confirmed();
          return;
        }
        setShown({
          kind: 'error',
          message: accountErrorMessage(err, "WhatsApp n'est pas disponible pour le moment."),
        });
      });
  }, [confirmed]);

  // One code when the view opens (R1) — once, even when React runs effects twice
  // in development; « Nouveau code » asks again.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    ask();
  }, [ask]);
  useEffect(() => title.current?.focus(), []);

  // R2: the wait, for the code on screen only.
  const token = shown.kind === 'code' ? shown.code.token : null;
  useEffect(() => {
    if (!token) return;
    const wait = waitForWhatsapp({
      ask: () => api.auth.whatsappStatus({ token, rememberDevice: rememberRef.current }),
      onOutcome: (outcome) => {
        if (outcome.status === 'signed_in') {
          handlers.current.onSignedIn?.(whatsappSignedIn(outcome));
        } else if (outcome.status === 'confirmed') {
          confirmed();
        } else {
          const view = whatsappOutcomeView(outcome.status, {
            app: 'customer',
            accountPhone: handlers.current.accountPhone ?? null,
          });
          setShown(
            outcome.status === 'not_confirmed'
              ? { kind: 'outcome', view, phone: outcome.phone }
              : { kind: 'outcome', view },
          );
        }
      },
      onError: (err) =>
        setShown({ kind: 'error', message: accountErrorMessage(err, 'Connexion impossible.') }),
    });
    const visible = () => {
      if (document.visibilityState === 'visible') wait.poke();
    };
    document.addEventListener('visibilitychange', visible);
    const clock = setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      wait.stop();
      document.removeEventListener('visibilitychange', visible);
      clearInterval(clock);
    };
  }, [token, confirmed]);

  function act(action: WhatsappAction) {
    if (action === 'new_code') ask();
    else if (action === 'email_login') handlers.current.onEmailLogin?.();
    else if (shown.kind === 'outcome' && shown.phone)
      handlers.current.onCreateAccount?.(shown.phone);
  }

  // The one live region (SPEC-023-05 R9): the wait, then the outcome, in the same place.
  const status =
    shown.kind === 'loading'
      ? 'Préparation du code…'
      : shown.kind === 'code'
        ? whatsappWaitingText(shown.code.expiresAt, now)
        : shown.kind === 'outcome'
          ? shown.view.message
          : shown.kind === 'confirmed'
            ? WHATSAPP_TEXT.confirmed
            : '';

  // FEAT-023-VIS02, VIS03: the picture in front of the text, never read aloud (R9).
  const icon =
    shown.kind === 'code'
      ? WHATSAPP_ICON.waiting
      : shown.kind === 'outcome'
        ? WHATSAPP_ICON.warning
        : shown.kind === 'confirmed'
          ? WHATSAPP_ICON.done
          : null;

  return (
    <div className={styles['panel']}>
      {props.before}
      <h2 ref={title} tabIndex={-1} className={styles['stepTitle']}>
        {props.purpose === 'login' ? WHATSAPP_TEXT.loginTitle : WHATSAPP_TEXT.confirmTitle}
      </h2>
      {props.intro}

      {shown.kind === 'code' && (
        <>
          <ol className={styles['whatsappSteps']}>
            <li>
              {WHATSAPP_TEXT.step1.replace(/^1\. /, '')}
              <q className={styles['whatsappMessage']} aria-hidden="true">
                {shown.code.text}
              </q>
              <VisuallyHidden>{spelled(shown.code.text, shown.code.code)}</VisuallyHidden>
            </li>
            <li>
              {(props.purpose === 'login'
                ? WHATSAPP_TEXT.step2
                : WHATSAPP_TEXT.step2FromNumber
              ).replace(/^2\. /, '')}
            </li>
          </ol>
          {props.purpose === 'login' && (
            <div className={styles['whatsappWarning']}>
              <span aria-hidden="true">{WHATSAPP_ICON.warning} </span>
              {WHATSAPP_TEXT.warning}
            </div>
          )}
          <a
            className={styles['primaryLink']}
            href={shown.code.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            <span aria-hidden="true">{WHATSAPP_ICON.open}&nbsp;</span>
            {WHATSAPP_TEXT.open}
          </a>
          <p className={styles['whatsappHint']}>{whatsappDesktopHint(shown.code.number)}</p>
          {props.remember && (
            <Checkbox
              label="Se souvenir de cet appareil"
              checked={props.remember.checked}
              onChange={(e) => props.remember?.onChange(e.target.checked)}
            />
          )}
        </>
      )}

      <p
        role="status"
        className={cx(
          styles['whatsappStatus'],
          shown.kind === 'outcome' && styles['whatsappOutcome'],
          shown.kind === 'confirmed' && styles['stepDone'],
        )}
      >
        {icon && <span aria-hidden="true">{icon} </span>}
        {status}
      </p>

      {shown.kind === 'outcome' &&
        shown.view.actions.map((action, i) => (
          <Button
            key={action}
            type="button"
            variant={i === 0 ? 'primary' : 'secondary'}
            fullWidth
            onClick={() => act(action)}
          >
            {whatsappActionLabel(action)}
          </Button>
        ))}
      {shown.kind === 'confirmed' && (
        <Button type="button" fullWidth onClick={() => handlers.current.onConfirmed?.()}>
          {WHATSAPP_TEXT.continue}
        </Button>
      )}
      {shown.kind === 'error' && <Alert tone="danger">{shown.message}</Alert>}

      {shown.kind !== 'confirmed' && (
        <Button
          type="button"
          variant={props.backVariant ?? 'ghost'}
          fullWidth
          onClick={props.onBack}
        >
          {props.backLabel ?? WHATSAPP_TEXT.otherWay}
        </Button>
      )}
    </div>
  );
}
