'use client';

import { useEffect, useRef, useState } from 'react';
import type { MeProfile } from '@djafat/sdk';
import { Stack, cx } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import { accountErrorMessage, phoneSectionState, type ChannelButton } from '@/lib/account';
import type { AuthMethods } from './LoginPanel';
import { ChannelRow } from './ChannelRow';
import { WhatsappStep } from './WhatsappStep';

interface PhoneSectionProps {
  readonly me: MeProfile;
  readonly methods: AuthMethods | undefined;
  readonly onUpdated: (me: MeProfile) => void;
  readonly cardClassName: string;
  readonly labelClassName: string;
  readonly valueClassName: string;
  readonly okClassName: string;
  readonly mutedClassName: string;
}

/**
 * « Mon profil » → « Téléphone » (FEAT-020, SPEC-020-09 R3-R4): the number and
 * whether it is confirmed. Confirming it — by SMS, or by WhatsApp (the
 * customer SENDS a code from this number, FEAT-023, SPEC-023-06) — lets phone
 * codes and WhatsApp messages open this account. A channel the server does
 * not offer yet says « Bientôt disponible ».
 */
export function PhoneSection(props: PhoneSectionProps) {
  const { me } = props;
  const state = phoneSectionState(me, props.methods ?? null);
  const [channel, setChannel] = useState<'sms' | 'whatsapp' | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start(button: ChannelButton) {
    setError(null);
    if (button.id === 'whatsapp') {
      setChannel('whatsapp');
      return;
    }
    setBusy(true);
    try {
      await api.auth.requestPhoneCode();
      setChannel('sms');
    } catch (err) {
      setError(accountErrorMessage(err, "Impossible d'envoyer le code."));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (channel !== 'sms') return;
    setError(null);
    setBusy(true);
    try {
      const profile = await api.auth.verifyPhone(code.trim());
      setChannel(null);
      setCode('');
      props.onUpdated(profile);
    } catch (err) {
      setError(accountErrorMessage(err, 'Code invalide ou expiré.'));
    } finally {
      setBusy(false);
    }
  }

  // Review FEAT-020 #12: when the form opens or closes, focus moves to its first control.
  const sectionRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // The WhatsApp view focuses its own title (SPEC-023-05 R9, review #11).
    if (channel === 'whatsapp') return;
    const section = sectionRef.current;
    // After a confirmation nothing is left to press: the section itself takes the focus.
    (
      section?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])') ??
      section
    )?.focus();
  }, [channel]);

  return (
    <section ref={sectionRef} tabIndex={-1} className={cx(props.cardClassName)}>
      <p className={cx(props.labelClassName)}>Téléphone</p>
      <p className={cx(props.valueClassName)}>
        {me.phone}{' '}
        {state.confirmed ? (
          <span className={cx(props.okClassName)}>Confirmé ✓</span>
        ) : (
          <span className={cx(props.mutedClassName)}>Non confirmé</span>
        )}
      </p>
      {!state.confirmed && (
        <Stack gap="sm">
          <p className={cx(props.mutedClassName)}>
            Confirmez votre numéro pour vous connecter aussi avec un code WhatsApp ou SMS.
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          {channel === 'whatsapp' ? (
            <WhatsappStep
              purpose="confirm"
              start={() => api.auth.startPhoneWhatsapp()}
              accountPhone={me.phone}
              onConfirmed={() => {
                setChannel(null);
                void api.auth
                  .me()
                  .then(props.onUpdated)
                  .catch(() => setError('Numéro confirmé : rechargez la page pour le voir.'));
              }}
              backLabel="Retour"
              onBack={() => setChannel(null)}
            />
          ) : channel === null ? (
            <ChannelRow
              buttons={[
                { ...state.whatsapp, label: 'Confirmer par WhatsApp' },
                { ...state.sms, label: 'Confirmer par SMS' },
              ]}
              label="Confirmer mon numéro"
              onSelect={(b) => void start(b)}
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void verify();
              }}
            >
              <Stack gap="sm">
                <Input
                  label="Code reçu par SMS"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  required
                />
                <Button type="submit" loading={busy}>
                  Vérifier
                </Button>
                <Button type="button" variant="ghost" onClick={() => setChannel(null)}>
                  Retour
                </Button>
              </Stack>
            </form>
          )}
        </Stack>
      )}
    </section>
  );
}
