'use client';

import { useState } from 'react';
import type { SignedIn } from '@djafat/sdk';
import { Alert, Button, FieldSuggestion, Input } from '@/components/ui-client';
import { api } from '@/lib/api';
import {
  DIAL_CODE,
  accountErrorMessage,
  emailSuggestionText,
  emailTypoCheck,
  fieldErrorsFromApi,
  maskEmail,
  phoneFieldShowsDialCode,
  validateRegisterForm,
  type FieldErrors,
  type RegisterField,
  type RegisterFormValues,
} from '@/lib/account';
import { CodeStep } from './CodeStep';
import { PasswordField } from './PasswordField';
import styles from './account.module.css';

interface RegisterPanelProps {
  readonly onSignedIn: (result: SignedIn) => void;
  /** « Se connecter » under a number that already has an account. */
  readonly onGoToLogin: () => void;
}

const FIELDS: readonly RegisterField[] = ['fullName', 'phone', 'email', 'password', 'confirm'];
const EMPTY: RegisterFormValues = { fullName: '', phone: '', email: '', password: '', confirm: '' };

/**
 * « Créer un compte » (FEAT-020-VIS02, SPEC-020-07 R3-R5): the form, checked
 * before sending, then the e-mail code. The account opens with the right code.
 */
export function RegisterPanel({ onSignedIn, onGoToLogin }: RegisterPanelProps) {
  const [values, setValues] = useState<RegisterFormValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [general, setGeneral] = useState<string | null>(null);
  /** The last API error's code: the « Se connecter » link under the number depends on it. */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /** Review 2 (WCAG 2.4.3): back from the code step, the form's first field takes the focus. */
  const [returned, setReturned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<{ id: string; email: string } | null>(null);
  /** FEAT-024 (SPEC-024-04): the address already stopped once, and the suggestion shown. */
  const [emailWarned, setEmailWarned] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);

  /** Editing a field clears its error; a new password also clears the confirmation's. */
  const set = (field: RegisterField) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setValues((v) => ({ ...v, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      if (field === 'password') delete next.confirm;
      return next;
    });
    if (field === 'phone') setErrorCode(null);
    if (field === 'email') setEmailHint(null);
  };

  async function submit() {
    const found = validateRegisterForm(values);
    setErrors(found);
    setGeneral(null);
    if (Object.keys(found).length > 0) return;
    // SPEC-024-04 R3, R4: a mistyped address stops the sending once.
    const typo = emailTypoCheck(values.email, emailWarned);
    setEmailWarned(typo.warned);
    setEmailHint(typo.suggestion);
    if (typo.suggestion) return;
    setBusy(true);
    try {
      const { registrationId } = await api.auth.register({
        fullName: values.fullName,
        phone: values.phone,
        email: values.email,
        password: values.password,
      });
      setRegistration({ id: registrationId, email: values.email.trim().toLowerCase() });
    } catch (err) {
      const mapped = fieldErrorsFromApi(err, FIELDS, "L'inscription n'a pas pu être envoyée.");
      setErrors(mapped.fields);
      setGeneral(mapped.general);
      setErrorCode(mapped.code);
    } finally {
      setBusy(false);
    }
  }

  if (registration) {
    return (
      <CodeStep
        title="Vérifiez votre e-mail"
        intro={`Entrez le code à 6 chiffres envoyé à ${maskEmail(registration.email)} (valable 5 min).`}
        busy={busy}
        error={general}
        submitLabel="Vérifier"
        onSubmit={(code) => {
          void (async () => {
            setGeneral(null);
            setBusy(true);
            try {
              onSignedIn(await api.auth.verifyRegistration(registration.id, code));
            } catch (err) {
              setGeneral(accountErrorMessage(err, 'Code invalide ou expiré.'));
            } finally {
              setBusy(false);
            }
          })();
        }}
        onResend={async () => {
          try {
            await api.auth.resendRegistration(registration.id);
          } catch (err) {
            setGeneral(accountErrorMessage(err, "Impossible d'envoyer le code."));
          }
        }}
        onBack={() => {
          setReturned(true);
          setRegistration(null);
          setGeneral(null);
        }}
      />
    );
  }

  const phoneTaken = errorCode === 'PHONE_ALREADY_USED' && Boolean(errors.phone);

  return (
    <form
      className={styles['panel']}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {general && <Alert tone="danger">{general}</Alert>}
      <Input
        autoFocus={returned}
        label="Nom complet"
        autoComplete="name"
        placeholder="Prénom Nom"
        value={values.fullName}
        onChange={set('fullName')}
        {...(errors.fullName ? { error: errors.fullName } : {})}
        required
      />
      <Input
        label="Numéro de téléphone"
        type="tel"
        autoComplete="tel"
        placeholder="66 12 34 56"
        {...(phoneFieldShowsDialCode(values.phone) ? { leadingText: DIAL_CODE } : {})}
        value={values.phone}
        onChange={set('phone')}
        {...(errors.phone ? { error: errors.phone } : {})}
        required
      />
      {phoneTaken && (
        <button type="button" className={styles['linkButton']} onClick={onGoToLogin}>
          Se connecter
        </button>
      )}
      <Input
        label="E-mail"
        type="email"
        autoComplete="email"
        placeholder="vous@gmail.com"
        value={values.email}
        onChange={set('email')}
        {...(errors.email ? { error: errors.email } : {})}
        required
      />
      <FieldSuggestion
        text={emailHint ? emailSuggestionText(emailHint) : null}
        actionLabel="Oui, corriger"
        onAction={() => {
          if (emailHint) setValues((v) => ({ ...v, email: emailHint }));
          setEmailHint(null);
        }}
      />
      <PasswordField
        label="Mot de passe (8 caractères minimum)"
        autoComplete="new-password"
        value={values.password}
        onChange={set('password')}
        error={errors.password}
        required
      />
      <PasswordField
        label="Confirmer le mot de passe"
        autoComplete="new-password"
        value={values.confirm}
        onChange={set('confirm')}
        error={errors.confirm}
        required
      />
      <Button type="submit" loading={busy} fullWidth>
        Créer mon compte
      </Button>
      <p className={styles['hint']}>Un code de confirmation sera envoyé à votre adresse e-mail.</p>
    </form>
  );
}
