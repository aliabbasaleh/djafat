import { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { ndjamenaDate } from '@djafat/core';
import { ApiClientError, type SignedIn } from '@djafat/sdk';
import { Button } from '../Button';
import { api, appUrl } from '../../lib/api';
import {
  ACCOUNT_TYPES,
  DIAL_CODE,
  OTHER_NEIGHBOURHOOD,
  VEHICLE_CHOICES,
  accountErrorMessage,
  backToAccountTypes,
  birthDateFromInput,
  chooseAccountType,
  emailSuggestionText,
  emailTypoCheck,
  fieldErrorsFromApi,
  maskEmail,
  phoneFieldShowsDialCode,
  registrationRequest,
  signupDoneText,
  startSignup,
  validateCourierFields,
  validateRegisterForm,
  validateRestaurantFields,
  type AccountType,
  type CourierFieldValues,
  type FieldErrors,
  type RegisterFormValues,
  type RestaurantFieldValues,
  type SignupFlow,
} from '../../lib/account';
import { ChoiceGroup } from './ChoiceGroup';
import { CodeStep } from './CodeStep';
import { Field } from './Field';
import { accountStyles as s } from './styles';

type FormField =
  | keyof RegisterFormValues
  | 'vehicle'
  | 'neighbourhood'
  | 'neighbourhoodOther'
  | 'birthDate'
  | 'acceptTerms'
  | 'restaurantName';

const API_FIELDS = [
  'fullName',
  'phone',
  'email',
  'password',
  'vehicle',
  'neighbourhoodId',
  'neighbourhoodOther',
  'birthDate',
  'acceptTerms',
  'restaurantName',
] as const;

const EMPTY: RegisterFormValues = { fullName: '', phone: '', email: '', password: '', confirm: '' };
const EMPTY_COURIER: CourierFieldValues = {
  vehicle: null,
  neighbourhood: '',
  neighbourhoodOther: '',
  birthDate: '',
  acceptTerms: false,
};
const EMPTY_RESTAURANT: RestaurantFieldValues = {
  restaurantName: '',
  neighbourhood: '',
  neighbourhoodOther: '',
  acceptTerms: false,
};
const TITLES: Record<AccountType, string> = {
  customer: 'Client',
  courier: 'Livreur',
  restaurant: 'Restaurant',
};

/**
 * « Créer un compte » in the app (FEAT-020-VIS02, SPEC-020-08; FEAT-022,
 * SPEC-022-01 R5): « Quel compte voulez-vous créer ? », then the type's form —
 * the same three forms as the site — then the e-mail code.
 */
export function RegisterForm({
  onSignedIn,
  onGoToLogin,
}: {
  readonly onSignedIn: (result: SignedIn) => Promise<void>;
  readonly onGoToLogin: () => void;
}) {
  const [flow, setFlow] = useState<SignupFlow<RegisterFormValues>>(() => startSignup(null, EMPTY));
  const [courier, setCourier] = useState<CourierFieldValues>(EMPTY_COURIER);
  /** What was typed in the birth date field (« 12/04/2001 »); the form keeps `YYYY-MM-DD`. */
  const [birthDateTyped, setBirthDateTyped] = useState('');
  const [restaurant, setRestaurant] = useState<RestaurantFieldValues>(EMPTY_RESTAURANT);
  const [neighbourhoods, setNeighbourhoods] = useState<Array<{ id: string; name: string }> | null>(
    null,
  );
  const [errors, setErrors] = useState<FieldErrors<FormField>>({});
  const [general, setGeneral] = useState<string | null>(null);
  /** The last API error's code: the « Se connecter » link under the number depends on it. */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<{ id: string; email: string } | null>(null);
  const [done, setDone] = useState<{ result: SignedIn; type: 'courier' | 'restaurant' } | null>(
    null,
  );
  /** FEAT-024 (SPEC-024-04): the address already stopped once, and the suggestion shown. */
  const [emailWarned, setEmailWarned] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);

  const values = flow.account;
  const type = flow.step === 'choice' ? null : flow.step;

  useEffect(() => {
    if ((type !== 'courier' && type !== 'restaurant') || neighbourhoods !== null) return;
    let cancelled = false;
    api.auth
      .neighbourhoods()
      .then((res) => !cancelled && setNeighbourhoods(res.neighbourhoods))
      .catch(() => !cancelled && setNeighbourhoods([]));
    return () => {
      cancelled = true;
    };
  }, [type, neighbourhoods]);

  function clear(field: FormField) {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      if (field === 'password') delete next.confirm;
      return next;
    });
  }

  /** Editing a field clears its error; a new password also clears the confirmation's. */
  const set = (field: keyof RegisterFormValues) => (text: string) => {
    setFlow((f) => ({ ...f, account: { ...f.account, [field]: text } }));
    clear(field);
    if (field === 'phone') setErrorCode(null);
    if (field === 'email') setEmailHint(null);
  };

  async function submit() {
    if (!type) return;
    const found: FieldErrors<FormField> = {
      ...validateRegisterForm(values),
      ...(type === 'courier' ? validateCourierFields(courier, ndjamenaDate(new Date())) : {}),
      ...(type === 'restaurant' ? validateRestaurantFields(restaurant) : {}),
    };
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
      // SPEC-022-01-SC03: a customer's request is FEAT-020's, no type added.
      const { registrationId } = await api.auth.register(
        registrationRequest(type, values, courier, restaurant),
      );
      setRegistration({ id: registrationId, email: values.email.trim().toLowerCase() });
    } catch (err) {
      const mapped = fieldErrorsFromApi(err, API_FIELDS, "L'inscription n'a pas pu être envoyée.");
      const { neighbourhoodId, ...rest } = mapped.fields;
      const onFields: FieldErrors<FormField> = {
        ...rest,
        ...(neighbourhoodId ? { neighbourhood: neighbourhoodId } : {}),
      };
      if (err instanceof ApiClientError && err.code === 'UNDERAGE')
        onFields.birthDate = err.message;
      if (err instanceof ApiClientError && err.code === 'NEIGHBOURHOOD_UNKNOWN') {
        onFields.neighbourhood = err.message;
      }
      setErrors(onFields);
      setGeneral(Object.keys(onFields).length > 0 ? null : mapped.general);
      setErrorCode(mapped.code);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    const text = signupDoneText(done.type, restaurant.restaurantName.trim());
    const target = appUrl(done.type === 'courier' ? 'courier' : 'restaurant');
    return (
      <View style={s.form}>
        <Text style={s.heading} accessibilityRole="header">
          {text.title}
        </Text>
        <Text style={s.intro}>{text.text}</Text>
        <Text style={s.hint}>Un e-mail « Bienvenue sur DJAFAT » vous rappelle ces étapes.</Text>
        {target ? (
          <Button label={text.action} fullWidth onPress={() => void Linking.openURL(target)} />
        ) : null}
        <Button
          label="Continuer dans DJAFAT"
          variant="ghost"
          fullWidth
          onPress={() => void onSignedIn(done.result)}
        />
      </View>
    );
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
              const result = await api.auth.verifyRegistration(registration.id, code);
              // A courier or a restaurant first reads what to complete, and where (SPEC-022-02 R6).
              if (type === 'courier' || type === 'restaurant') setDone({ result, type });
              else await onSignedIn(result);
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

  if (!type) {
    return (
      <View style={s.form}>
        <Text style={s.heading} accessibilityRole="header">
          Quel compte voulez-vous créer ?
        </Text>
        {ACCOUNT_TYPES.map((choice) => (
          <Pressable
            key={choice.id}
            accessibilityRole="button"
            accessibilityLabel={`${choice.title} : ${choice.description}`}
            onPress={() => {
              setFlow((f) => chooseAccountType(f, choice.id));
              setErrors({});
              setGeneral(null);
            }}
            style={s.typeCard}
          >
            <Text style={s.typeIcon} importantForAccessibility="no">
              {choice.icon}
            </Text>
            <View>
              <Text style={s.typeTitle}>{choice.title}</Text>
              <Text style={s.typeDescription}>{choice.description}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    );
  }

  const phoneTaken = errorCode === 'PHONE_ALREADY_USED' && Boolean(errors.phone);
  const neighbourhoodOptions = [
    ...(neighbourhoods ?? []).map((n) => ({ id: n.id, label: n.name })),
    { id: OTHER_NEIGHBOURHOOD, label: 'Autre' },
  ];
  const termsLink = appUrl('site');
  const terms = (checked: boolean, onChange: (value: boolean) => void) => (
    <View style={s.field}>
      <Pressable
        style={s.checkboxRow}
        accessibilityRole="checkbox"
        aria-checked={checked}
        accessibilityState={{ checked }}
        onPress={() => {
          onChange(!checked);
          clear('acceptTerms');
        }}
      >
        <View style={[s.checkbox, checked && s.checkboxOn]}>
          {checked ? <Text style={s.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={s.label}>J&apos;accepte les conditions d&apos;utilisation</Text>
      </Pressable>
      {termsLink ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void Linking.openURL(`${termsLink}/conditions`)}
        >
          <Text style={s.link}>Lire les conditions d’utilisation</Text>
        </Pressable>
      ) : null}
      {errors.acceptTerms ? (
        <Text style={s.fieldError} accessibilityLiveRegion="polite">
          {errors.acceptTerms}
        </Text>
      ) : null}
    </View>
  );
  const neighbourhood = (
    current: { neighbourhood: string; neighbourhoodOther: string },
    update: (patch: Partial<{ neighbourhood: string; neighbourhoodOther: string }>) => void,
    label: string,
  ) => (
    <>
      <ChoiceGroup
        label={neighbourhoods ? label : `${label} (chargement…)`}
        options={neighbourhoodOptions}
        value={current.neighbourhood || null}
        error={errors.neighbourhood}
        onChange={(value) => {
          update({ neighbourhood: value });
          clear('neighbourhood');
        }}
      />
      {current.neighbourhood === OTHER_NEIGHBOURHOOD ? (
        <Field
          label="Nom du quartier"
          value={current.neighbourhoodOther}
          maxLength={60}
          onChangeText={(text) => {
            update({ neighbourhoodOther: text });
            clear('neighbourhoodOther');
          }}
          error={errors.neighbourhoodOther}
        />
      ) : null}
    </>
  );

  return (
    <View style={s.form}>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setFlow((f) => backToAccountTypes(f));
          setErrors({});
          setGeneral(null);
        }}
      >
        <Text style={s.link}>← Changer de type</Text>
      </Pressable>
      <Text style={s.heading} accessibilityRole="header">
        {TITLES[type]}
      </Text>
      {general ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{general}</Text>
        </View>
      ) : null}
      {type === 'restaurant' ? <Text style={s.groupTitle}>Vous (responsable)</Text> : null}
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
        leadingText={phoneFieldShowsDialCode(values.phone) ? DIAL_CODE : undefined}
        error={errors.phone}
      />
      {phoneTaken ? (
        <Pressable accessibilityRole="button" onPress={onGoToLogin}>
          <Text style={s.link}>Se connecter</Text>
        </Pressable>
      ) : null}
      <Field
        label={type === 'customer' ? 'E-mail' : 'E-mail (votre identifiant)'}
        value={values.email}
        onChangeText={set('email')}
        placeholder="vous@gmail.com"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoCapitalize="none"
        error={errors.email}
        suggestion={
          emailHint
            ? {
                text: emailSuggestionText(emailHint),
                onAccept: () => {
                  setFlow((f) => ({ ...f, account: { ...f.account, email: emailHint } }));
                  setEmailHint(null);
                },
              }
            : null
        }
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

      {type === 'courier' ? (
        <>
          <ChoiceGroup
            label="Véhicule"
            options={VEHICLE_CHOICES}
            value={courier.vehicle}
            error={errors.vehicle}
            onChange={(vehicle) => {
              setCourier((c) => ({ ...c, vehicle }));
              clear('vehicle');
            }}
          />
          {neighbourhood(
            courier,
            (patch) => setCourier((c) => ({ ...c, ...patch })),
            'Quartier où vous travaillez',
          )}
          <Field
            label="Date de naissance (JJ/MM/AAAA)"
            value={birthDateTyped}
            onChangeText={(text) => {
              setBirthDateTyped(text);
              setCourier((c) => ({ ...c, birthDate: birthDateFromInput(text) }));
              clear('birthDate');
            }}
            placeholder="12/04/2001"
            keyboardType="numbers-and-punctuation"
            error={errors.birthDate}
          />
          {terms(courier.acceptTerms, (acceptTerms) => setCourier((c) => ({ ...c, acceptTerms })))}
        </>
      ) : null}

      {type === 'restaurant' ? (
        <>
          <Text style={s.groupTitle}>Votre restaurant</Text>
          <Field
            label="Nom du restaurant"
            value={restaurant.restaurantName}
            maxLength={80}
            onChangeText={(text) => {
              setRestaurant((r) => ({ ...r, restaurantName: text }));
              clear('restaurantName');
            }}
            placeholder="Chez Fatimé"
            error={errors.restaurantName}
          />
          {neighbourhood(
            restaurant,
            (patch) => setRestaurant((r) => ({ ...r, ...patch })),
            "Quartier (N'Djamena)",
          )}
          {terms(restaurant.acceptTerms, (acceptTerms) =>
            setRestaurant((r) => ({ ...r, acceptTerms })),
          )}
        </>
      ) : null}

      <Button label="Créer mon compte" loading={busy} fullWidth onPress={() => void submit()} />
      <Text style={s.hint}>Un code de confirmation sera envoyé à votre adresse e-mail.</Text>
    </View>
  );
}
