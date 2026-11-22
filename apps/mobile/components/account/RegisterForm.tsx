import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { SignedIn } from '@djafat/sdk';
import { Button } from '../Button';
import { api } from '../../lib/api';
import {
  accountErrorMessage,
  fieldErrorsFromApi,
  maskEmail,
  validateRegisterForm,
  type FieldErrors,
  type RegisterField,
  type RegisterFormValues,
} from '../../lib/account';
import { CodeStep } from './CodeStep';
import { Field } from './Field';
import { accountStyles as s } from './styles';

const FIELDS: readonly RegisterField[] = ['fullName', 'phone', 'email', 'password', 'confirm'];
const EMPTY: RegisterFormValues = { fullName: '', phone: '', email: '', password: '', confirm: '' };

/** « Créer un compte » in the app (FEAT-020-VIS02, SPEC-020-08): the form, then the e-mail code. */
export function RegisterForm({
  onSignedIn,
  onGoToLogin,
}: {
  readonly onSignedIn: (result: SignedIn) => Promise<void>;
  readonly onGoToLogin: () => void;
}) {
  const [values, setValues] = useState<RegisterFormValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<RegisterField>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<{ id: string; email: string } | null>(null);

  /** Editing a field clears its error; a new password also clears the confirmation's. */
  const set = (field: RegisterField) => (text: string) => {
    setValues((v) => ({ ...v, [field]: text }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      if (field === 'password') delete next.confirm;
      return next;
    });
  };

  async function submit() {
    const found = validateRegisterForm(values);
    setErrors(found);
    setGeneral(null);
    if (Object.keys(found).length > 0) return;
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
        submitLabel="Créer mon compte"
        onSubmit={(code) => {
          void (async () => {
            setGeneral(null);
            setBusy(true);
            try {
              await onSignedIn(await api.auth.verifyRegistration(registration.id, code));
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
          setRegistration(null);
          setGeneral(null);
        }}
      />
    );
  }

  const phoneTaken = errors.phone?.startsWith('Ce numéro a déjà un compte') ?? false;

  return (
    <View style={s.form}>
      {general ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{general}</Text>
        </View>
      ) : null}
      <Field
        label="Nom complet"
        value={values.fullName}
        onChangeText={set('fullName')}
        placeholder="Prénom Nom"
        textContentType="name"
        autoCapitalize="words"
        error={errors.fullName}
      />
      <Field
        label="Numéro de téléphone"
        value={values.phone}
        onChangeText={set('phone')}
        placeholder="66 12 34 56"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        error={errors.phone}
      />
      {phoneTaken ? (
        <Pressable accessibilityRole="button" onPress={onGoToLogin}>
          <Text style={s.link}>Se connecter</Text>
        </Pressable>
      ) : null}
      <Field
        label="E-mail"
        value={values.email}
        onChangeText={set('email')}
        placeholder="vous@gmail.com"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoCapitalize="none"
        error={errors.email}
      />
      <Field
        label="Mot de passe (8 caractères minimum)"
        secret
        textContentType="newPassword"
        value={values.password}
        onChangeText={set('password')}
        error={errors.password}
      />
      <Field
        label="Confirmer le mot de passe"
        secret
        textContentType="newPassword"
        value={values.confirm}
        onChangeText={set('confirm')}
        error={errors.confirm}
      />
      <Button label="Créer mon compte" loading={busy} fullWidth onPress={() => void submit()} />
      <Text style={s.hint}>Un code de confirmation sera envoyé à votre adresse e-mail.</Text>
    </View>
  );
}
