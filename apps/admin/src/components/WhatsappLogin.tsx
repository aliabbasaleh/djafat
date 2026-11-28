'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WHATSAPP_TEXT,
  accountErrorMessage,
  waitForWhatsapp,
  whatsappActionLabel,
  whatsappDesktopHint,
  whatsappOutcomeView,
  whatsappWaitingText,
  type SignedIn,
  type WhatsappAction,
  type WhatsappCode,
  type WhatsappOutcomeView,
} from '@djafat/sdk';
import { Stack, Text, VisuallyHidden, cx } from '@djafat/ui';
import { Alert, Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import styles from './WhatsappLogin.module.css';

type Shown =
  | { readonly kind: 'loading' }
  | { readonly kind: 'code'; readonly code: WhatsappCode }
  | { readonly kind: 'outcome'; readonly view: WhatsappOutcomeView }
  | { readonly kind: 'error'; readonly message: string };

interface WhatsappLoginProps {
  /** The session the wait ended with — the page passes it through `teamWhatsappSignIn` (R2). */
  readonly onSignedIn: (answer: { readonly status: 'signed_in' } & SignedIn) => void;
  readonly onEmailLogin: () => void;
  readonly onBack: () => void;
}

/**
 * WhatsApp in a team console's login (FEAT-023, SPEC-023-07): the same view
 * as the site (FEAT-023-VIS02) — the message to send, « Ouvrir WhatsApp », the
 * wait every 2 s — then the console's role check. One live region says the
 * wait and the outcome; « Ce numéro n'est confirmé sur aucun compte » offers
 * « Se connecter par e-mail » only (R3).
 */
export function WhatsappLogin(props: WhatsappLoginProps) {
  const [shown, setShown] = useState<Shown>({ kind: 'loading' });
  const [now, setNow] = useState(() => Date.now());
  const title = useRef<HTMLHeadingElement>(null);
  const handlers = useRef(props);
  handlers.current = props;

  const ask = useCallback(() => {
    setShown({ kind: 'loading' });
    api.auth
      .startWhatsapp()
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

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    ask();
  }, [ask]);
  useEffect(() => title.current?.focus(), []);

  const token = shown.kind === 'code' ? shown.code.token : null;
  useEffect(() => {
    if (!token) return;
    const wait = waitForWhatsapp({
      ask: () => api.auth.whatsappStatus({ token }),
      onOutcome: (outcome) => {
        if (outcome.status === 'signed_in') {
          handlers.current.onSignedIn(outcome);
        } else if (outcome.status !== 'confirmed') {
          setShown({ kind: 'outcome', view: whatsappOutcomeView(outcome.status, { app: 'team' }) });
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
  }, [token]);

  function act(action: WhatsappAction) {
    if (action === 'new_code') ask();
    else handlers.current.onEmailLogin();
  }

  // The one live region: the wait, then the outcome, in the same place.
  const status =
    shown.kind === 'loading'
      ? 'Préparation du code…'
      : shown.kind === 'code'
        ? whatsappWaitingText(shown.code.expiresAt, now)
        : shown.kind === 'outcome'
          ? shown.view.message
          : '';

  return (
    <Stack gap="md">
      <h2 ref={title} tabIndex={-1} className={cx(styles['title'])}>
        {WHATSAPP_TEXT.loginTitle}
      </h2>
      {shown.kind === 'code' && (
        <>
          <ol className={cx(styles['steps'])}>
            <li>
              {WHATSAPP_TEXT.step1.replace(/^1\. /, '')}
              <q aria-hidden="true" className={cx(styles['message'])}>
                {shown.code.text}
              </q>
              <VisuallyHidden>
                {shown.code.text.replace(shown.code.code, shown.code.code.split('').join(' '))}
              </VisuallyHidden>
            </li>
            <li>{WHATSAPP_TEXT.step2.replace(/^2\. /, '')}</li>
          </ol>
          <div className={cx(styles['box'])}>
            <span aria-hidden="true">⚠️ </span>
            {WHATSAPP_TEXT.warning}
          </div>
          <a
            href={shown.code.link}
            target="_blank"
            rel="noopener noreferrer"
            className={cx(styles['open'])}
          >
            <span aria-hidden="true">🟢&nbsp;</span>
            {WHATSAPP_TEXT.open}
          </a>
          <Text tone="secondary">{whatsappDesktopHint(shown.code.number)}</Text>
        </>
      )}
      <p role="status" className={cx(styles['status'], shown.kind === 'outcome' && styles['box'])}>
        {status}
      </p>
      {shown.kind === 'outcome' &&
        shown.view.actions.map((action) => (
          <Button key={action} type="button" fullWidth onClick={() => act(action)}>
            {whatsappActionLabel(action)}
          </Button>
        ))}
      {shown.kind === 'error' && <Alert tone="danger">{shown.message}</Alert>}
      <Button type="button" variant="ghost" fullWidth onClick={props.onBack}>
        {WHATSAPP_TEXT.otherWay}
      </Button>
    </Stack>
  );
}
