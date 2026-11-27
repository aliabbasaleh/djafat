import { useEffect, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, Linking, Pressable, Text, View, type TextInput } from 'react-native';
import { ndjamenaDate } from '@djafat/core';
import type { SignedIn } from '@djafat/sdk';
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
  emailSuggestionFor,
  emailSuggestionText,
  emailTypoCheck,
  maskEmail,
  phoneFieldShowsDialCode,
  registrationRequest,
  signupDoneText,
  signupFieldErrors,
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

/** The form's order: after a refusal, the first field in error takes the focus (WCAG 2.4.3). */
const FOCUS_ORDER: readonly FormField[] = [
  'fullName',
  'phone',
  'email',
  'password',
  'confirm',
  'vehicle',
  'restaurantName',
  'neighbourhood',
  'neighbourhoodOther',
  'birthDate',
  'acceptTerms',
];

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
  onSignedUp,
  onContinue,
  onGoToLogin,
}: {
  /** A customer: the session is kept and the app goes on (FEAT-020, unchanged). */
  readonly onSignedIn: (result: SignedIn) => Promise<void>;
  /** A courier or a restaurant: the session is kept at once, « what next » stays (SPEC-022-02 R4). */
  readonly onSignedUp: (result: SignedIn) => Promise<void>;
  /** « Continuer dans DJAFAT » after « what next ». */
  readonly onContinue: () => void;
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
  const [done, setDone] = useState<{ type: 'courier' | 'restaurant' } | null>(null);
  /** Focus targets (review of FEAT-024, notes 1 and 16). */
  const title = useRef<Text>(null);
  const choiceTitle = useRef<Text>(null);
  /** « ← Changer de type » was touched: the choice's title takes the focus again (SPEC-022-01 « UI »). */
  const [cameBack, setCameBack] = useState(false);
  const fields = {
    fullName: useRef<TextInput>(null),
    phone: useRef<TextInput>(null),
    email: useRef<TextInput>(null),
    password: useRef<TextInput>(null),
    confirm: useRef<TextInput>(null),
    restaurantName: useRef<TextInput>(null),
    neighbourhoodOther: useRef<TextInput>(null),
    birthDate: useRef<TextInput>(null),
  } satisfies Partial<Record<FormField, RefObject<TextInput | null>>>;
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

  // SPEC-022-01 « UI »: the form's title takes the screen reader's focus when it opens,
  // and the choice's title when « ← Changer de type » brings it back.
  useEffect(() => {
    if (type && title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
    if (!type && cameBack && choiceTitle.current) {
      AccessibilityInfo.sendAccessibilityEvent(choiceTitle.current, 'focus');
    }
  }, [type, cameBack]);

  /** After a refusal: the first field in error takes the focus, or its message is read out. */
  function focusFirstError(found: FieldErrors<FormField>) {
    const first = FOCUS_ORDER.find((field) => found[field]);
    if (!first) return;
    const ref = (fields as Partial<Record<FormField, RefObject<TextInput | null>>>)[first];
    if (ref?.current) ref.current.focus();
    else AccessibilityInfo.announceForAccessibility(found[first] ?? '');
  }

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
    if (Object.keys(found).length > 0) {
      // SPEC-024-04 R2: a malformed address may still be a known provider mistyped.
      if (found.email) setEmailHint(emailSuggestionFor(values.email));
      focusFirstError(found);
      return;
    }
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
      const mapped = signupFieldErrors(err, "L'inscription n'a pas pu être envoyée.");
      setErrors(mapped.fields);
      setGeneral(mapped.general);
      setErrorCode(mapped.code);
      focusFirstError(mapped.fields);
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
        <Button label="Continuer dans DJAFAT" variant="ghost" fullWidth onPress={onContinue} />
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
              // A courier or a restaurant: the session at once, then what to complete (SPEC-022-02 R4, R6).
              if (type === 'courier' || type === 'restaurant') {
                await onSignedUp(result);
                setDone({ type });
              } else {
                await onSignedIn(result);
              }
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
        <Text ref={choiceTitle} style={s.heading} accessibilityRole="header">
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
          inputRef={fields.neighbourhoodOther}
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
          setCameBack(true);
        }}
      >
        <Text style={s.link}>← Changer de type</Text>
      </Pressable>
      <Text ref={title} style={s.heading} accessibilityRole="header">
        {TITLES[type]}
      </Text>
      {general ? (
        <View style={s.errorBox}>
          <Text style={s.errorText}>{general}</Text>
        </View>
      ) : null}
      {type === 'restaurant' ? <Text style={s.groupTitle}>Vous (responsable)</Text> : null}
      <Field
        inputRef={fields.fullName}
        label="Nom complet"
        value={values.fullName}
        onChangeText={set('fullName')}
        placeholder="Prénom Nom"
        textContentType="name"
        autoCapitalize="words"
        error={errors.fullName}
      />
      <Field
        inputRef={fields.phone}
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
        inputRef={fields.email}
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
                  fields.email.current?.focus();
                },
              }
            : null
        }
      />
      <Field
        inputRef={fields.password}
        label="Mot de passe (8 caractères minimum)"
        secret
        textContentType="newPassword"
        value={values.password}
        onChangeText={set('password')}
        error={errors.password}
      />
      <Field
        inputRef={fields.confirm}
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
            inputRef={fields.birthDate}
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
            inputRef={fields.restaurantName}
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
