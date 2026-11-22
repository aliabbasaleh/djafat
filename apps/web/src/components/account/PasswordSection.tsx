'use client';

import { useState } from 'react';
import type { MeProfile } from '@djafat/sdk';
import { Stack, cx } from '@djafat/ui';
import { Alert, Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import {
  fieldErrorsFromApi,
  passwordSectionMode,
  validateNewPassword,
  type FieldErrors,
} from '@/lib/account';
import { PasswordField } from './PasswordField';
import styles from './account.module.css';

type Field = 'currentPassword' | 'newPassword' | 'confirm';

interface PasswordSectionProps {
  readonly me: MeProfile;
  /** The profile changed (`hasPassword`): reload it. */
  readonly onChanged: () => void;
  readonly cardClassName: string;
  readonly labelClassName: string;
  readonly mutedClassName: string;
}

/**
 * « Mon profil » → « Mot de passe » (FEAT-020, SPEC-020-09 R1-R2): change it
 * (the current one is asked), set a first one (an account created by WhatsApp
 * or SMS), or first add an e-mail — a password logs in with the e-mail.
 */
export function PasswordSection(props: PasswordSectionProps) {
  const { me } = props;
  const mode = passwordSectionMode(me);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (mode === 'needs-email') {
    return (
      <section className={cx(props.cardClassName)}>
        <p className={cx(props.labelClassName)}>Mot de passe</p>
        <p className={cx(props.mutedClassName)}>
          Ajoutez votre e-mail ci-dessus pour pouvoir vous connecter avec un mot de passe.
        </p>
      </section>
    );
  }

  async function submit() {
    const found = validateNewPassword(next, confirm, {
      email: me.email,
      phone: me.phone,
      fullName: me.fullName,
    });
    const mapped: FieldErrors<Field> = {
      ...(found.password ? { newPassword: found.password } : {}),
      ...(found.confirm ? { confirm: found.confirm } : {}),
    };
    setErrors(mapped);
    setMessage(null);
    if (Object.keys(mapped).length > 0) return;
    setBusy(true);
    try {
      await api.auth.changePassword(
        mode === 'change' ? { currentPassword: current, newPassword: next } : { newPassword: next },
      );
      setCurrent('');
      setNext('');
      setConfirm('');
      setMessage({
        tone: 'success',
        text: 'Mot de passe modifié. Vos autres appareils ont été déconnectés.',
      });
      props.onChanged();
    } catch (err) {
      const result = fieldErrorsFromApi(
        err,
        ['currentPassword', 'newPassword'] as const,
        'Le mot de passe n’a pas pu être changé.',
      );
      setErrors(result.fields);
      if (result.general) setMessage({ tone: 'danger', text: result.general });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cx(props.cardClassName)}>
      <p className={cx(props.labelClassName)}>Mot de passe</p>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Stack gap="sm">
          {mode === 'change' && (
            <PasswordField
              label="Mot de passe actuel"
              autoComplete="current-password"
              value={current}
              onChange={(e) => {
                setCurrent(e.target.value);
                setErrors(({ currentPassword: _c, ...rest }) => rest);
              }}
              error={errors.currentPassword}
              required
            />
          )}
          <PasswordField
            label="Nouveau mot de passe"
            autoComplete="new-password"
            value={next}
            onChange={(e) => {
              setNext(e.target.value);
              setErrors(({ newPassword: _n, confirm: _f, ...rest }) => rest);
            }}
            error={errors.newPassword}
            required
          />
          <PasswordField
            label="Confirmer le mot de passe"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setErrors(({ confirm: _f, ...rest }) => rest);
            }}
            error={errors.confirm}
            required
          />
          <Button type="submit" variant="secondary" loading={busy}>
            {mode === 'change' ? 'Changer le mot de passe' : 'Définir un mot de passe'}
          </Button>
          {mode === 'set' && (
            <p className={styles['hint']}>
              Vous pourrez ensuite vous connecter avec votre e-mail et ce mot de passe.
            </p>
          )}
        </Stack>
      </form>
    </section>
  );
}
