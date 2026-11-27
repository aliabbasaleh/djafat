'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  WHATSAPP_TEXT,
  notConfirmedActions,
  waitForWhatsapp,
  whatsappDesktopHint,
  whatsappSignedIn,
  whatsappWaitingText,
  whatsappWrongNumberText,
  type SignedIn,
  type WhatsappCode,
  type WhatsappOutcome,
} from '@djafat/sdk';
import { Text, VisuallyHidden } from '@djafat/ui';
import { Alert, Button, Checkbox } from '@/components/ui-client';
import { api } from '@/lib/api';
import { accountErrorMessage } from '@/lib/account';
import styles from './account.module.css';

interface WhatsappStepProps {
  /** A login (the warning shows) or the confirmation of the account's number. */
  readonly purpose: 'login' | 'confirm';
  /** Asks the API for a code to send: `startWhatsapp` or `startPhoneWhatsapp`. */
  readonly start: () => Promise<WhatsappCode>;
  readonly title?: string;
  /** Shown above the title (FEAT-023-VIS03: « ✅ Votre compte est créé. »). */
  readonly before?: ReactNode;
  /** Shown under the title. */
  readonly intro?: ReactNode;
  /** New device: « Se souvenir de cet appareil », sent with each question. */
  readonly remember?: { readonly checked: boolean; readonly onChange: (v: boolean) => void };
  /** The account's number, named when the message came from another one. */
  readonly accountPhone?: string | null;
  readonly onSignedIn?: (signedIn: SignedIn) => void;
  readonly onConfirmed?: () => void;
  /** « Créer un compte » with the number that wrote (SPEC-023-05 R4). */
  readonly onCreateAccount?: (phone: string) => void;
  /** « Se connecter par e-mail ». */
  readonly onEmailLogin?: () => void;
  readonly backLabel?: string;
  readonly onBack: () => void;
}

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'code'; readonly code: WhatsappCode }
  | { readonly kind: 'outcome'; readonly outcome: WhatsappOutcome }
  | { readonly kind: 'error'; readonly message: string };

/** The digits read one by one by a screen reader (SPEC-023-05 R9). */
const spelled = (text: string, code: string) => text.replace(code, code.split('').join(' '));

/**
 * The free WhatsApp view (FEAT-023-VIS02, VIS03; SPEC-023-05, SPEC-023-06): the
 * message already written with its code, « Ouvrir WhatsApp », how to send it
 * from a computer, then the wait — every 2 s and at once when the page is
 * visible again — and its outcome. DJAFAT sends nothing on WhatsApp.
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

  const ask = useCallback(() => {
    setShown({ kind: 'loading' });
    handlers.current
      .start()
      .then((code) => {
        setNow(Date.now()); // the validity counts from the code's arrival
        setShown({ kind: 'code', code });
      })
      .catch((err: unknown) =>
        setShown({
          kind: 'error',
          message: accountErrorMessage(err, "WhatsApp n'est pas disponible pour le moment."),
        }),
      );
  }, []);

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
          return;
        }
        if (outcome.status === 'confirmed') {
          handlers.current.onConfirmed?.();
          return;
        }
        setShown({ kind: 'outcome', outcome });
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
  }, [token]);

  const back = (
    <Button type="button" variant="ghost" fullWidth onClick={props.onBack}>
      {props.backLabel ?? WHATSAPP_TEXT.otherWay}
    </Button>
  );
  const newCode = (
    <Button type="button" fullWidth onClick={ask}>
      {WHATSAPP_TEXT.newCode}
    </Button>
  );

  return (
    <div className={styles['panel']}>
      {props.before}
      <h2 ref={title} tabIndex={-1} className={styles['stepTitle']}>
        {props.title ??
          (props.purpose === 'login' ? WHATSAPP_TEXT.loginTitle : WHATSAPP_TEXT.confirmTitle)}
      </h2>
      {props.intro}

      {shown.kind === 'loading' && <Text tone="secondary">Préparation du code…</Text>}

      {shown.kind === 'error' && (
        <>
          <Alert tone="danger">{shown.message}</Alert>
          {back}
        </>
      )}

      {shown.kind === 'outcome' && (
        <div role="status" className={styles['panel']}>
          {shown.outcome.status === 'not_confirmed' && (
            <>
              <Alert tone="warning">{WHATSAPP_TEXT.notConfirmed}</Alert>
              {notConfirmedActions('customer').map((action) =>
                action === 'create_account' ? (
                  <Button
                    key={action}
                    type="button"
                    fullWidth
                    onClick={() => {
                      if (shown.outcome.status === 'not_confirmed') {
                        handlers.current.onCreateAccount?.(shown.outcome.phone);
                      }
                    }}
                  >
                    {WHATSAPP_TEXT.createAccount}
                  </Button>
                ) : (
                  <Button
                    key={action}
                    type="button"
                    variant="secondary"
                    fullWidth
                    onClick={() => handlers.current.onEmailLogin?.()}
                  >
                    {WHATSAPP_TEXT.emailLogin}
                  </Button>
                ),
              )}
            </>
          )}
          {shown.outcome.status === 'expired' && (
            <>
              <Alert tone="warning">{WHATSAPP_TEXT.expired}</Alert>
              {newCode}
            </>
          )}
          {shown.outcome.status === 'wrong_number' && (
            <>
              <Alert tone="warning">{whatsappWrongNumberText(props.accountPhone)}</Alert>
              {newCode}
            </>
          )}
          {back}
        </div>
      )}

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
          {props.purpose === 'login' && <Alert tone="warning">{WHATSAPP_TEXT.warning}</Alert>}
          <a
            className={styles['primaryLink']}
            href={shown.code.link}
            target="_blank"
            rel="noopener noreferrer"
          >
            🟢 {WHATSAPP_TEXT.open}
          </a>
          <Text tone="secondary">{whatsappDesktopHint(shown.code.number)}</Text>
          {props.remember && (
            <Checkbox
              label="Se souvenir de cet appareil"
              checked={props.remember.checked}
              onChange={(e) => props.remember?.onChange(e.target.checked)}
            />
          )}
          <p role="status" className={styles['whatsappWaiting']}>
            {whatsappWaitingText(shown.code.expiresAt, now)}
          </p>
          {back}
        </>
      )}
    </div>
  );
}
