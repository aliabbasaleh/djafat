'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ndjamenaDate } from '@djafat/core';
import { ApiClientError, type SignedIn } from '@djafat/sdk';
import { Alert, Button, Checkbox, FieldSuggestion, Input, Radio } from '@/components/ui-client';
import { api } from '@/lib/api';
import {
  DIAL_CODE,
  VEHICLE_CHOICES,
  accountErrorMessage,
  backToAccountTypes,
  chooseAccountType,
  emailSuggestionText,
  emailTypoCheck,
  fieldErrorsFromApi,
  maskEmail,
  phoneFieldShowsDialCode,
  registrationRequest,
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
} from '@/lib/account';
import { AccountTypeChoice } from './AccountTypeChoice';
import { CodeStep } from './CodeStep';
import { NeighbourhoodField, type NeighbourhoodOption } from './NeighbourhoodField';
import { PasswordField } from './PasswordField';
import { SignupDone } from './SignupDone';
import styles from './account.module.css';

interface RegisterPanelProps {
  /** A customer: the session is kept and the visitor goes on (FEAT-020, unchanged). */
  readonly onSignedIn: (result: SignedIn) => void;
  /** A courier or a restaurant: the session is kept, the « what next » screen stays (SPEC-022-02 R6). */
  readonly onSignedUp: (result: SignedIn) => void;
  /** « Se connecter » under a number that already has an account. */
  readonly onGoToLogin: () => void;
  /** `?inscription=livreur | restaurant | client` (SPEC-022-01 R4). */
  readonly initialType?: string | null;
}

type Field =
  | keyof RegisterFormValues
  | 'vehicle'
  | 'neighbourhood'
  | 'neighbourhoodOther'
  | 'birthDate'
  | 'acceptTerms'
  | 'restaurantName';

/** Where the API puts an error, mapped to the screen's fields (`neighbourhoodId` is « Quartier »). */
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
 * « Créer un compte » (FEAT-020-VIS02; FEAT-022, SPEC-022-01 to 03): first
 * « Quel compte voulez-vous créer ? », then the type's form — the customer's
 * of FEAT-020 unchanged, the courier's with vehicle, neighbourhood, birth date
 * and terms, the restaurant's with its name and neighbourhood — checked
 * before sending (FEAT-024 rules included), then the e-mail code.
 */
export function RegisterPanel({
  onSignedIn,
  onSignedUp,
  onGoToLogin,
  initialType,
}: RegisterPanelProps) {
  const [flow, setFlow] = useState<SignupFlow<RegisterFormValues>>(() =>
    startSignup(initialType, EMPTY),
  );
  const [courier, setCourier] = useState<CourierFieldValues>(EMPTY_COURIER);
  const [restaurant, setRestaurant] = useState<RestaurantFieldValues>(EMPTY_RESTAURANT);
  const [neighbourhoods, setNeighbourhoods] = useState<NeighbourhoodOption[] | null>(null);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [general, setGeneral] = useState<string | null>(null);
  /** The last API error's code: the « Se connecter » link under the number depends on it. */
  const [errorCode, setErrorCode] = useState<string | null>(null);
  /** Review 2 (WCAG 2.4.3): back from the code step, the form's first field takes the focus. */
  const [returned, setReturned] = useState(false);
  /** SPEC-022-01 « UI »: the focus follows the step (form title, then the choice again). */
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [registration, setRegistration] = useState<{ id: string; email: string } | null>(null);
  const [done, setDone] = useState<{ type: 'courier' | 'restaurant'; name: string } | null>(null);
  /** FEAT-024 (SPEC-024-04): the address already stopped once, and the suggestion shown. */
  const [emailWarned, setEmailWarned] = useState<string | null>(null);
  const [emailHint, setEmailHint] = useState<string | null>(null);
  const formTitle = useRef<HTMLHeadingElement>(null);

  const values = flow.account;
  const type = flow.step === 'choice' ? null : flow.step;

  // The neighbourhood list (SPEC-022-09 R5, public): once, when a courier or restaurant form opens.
  useEffect(() => {
    if (type !== 'courier' && type !== 'restaurant') return;
    if (neighbourhoods !== null) return;
    let cancelled = false;
    api.auth
      .neighbourhoods()
      .then((res) => !cancelled && setNeighbourhoods(res.neighbourhoods))
      .catch(() => !cancelled && setNeighbourhoods([]));
    return () => {
      cancelled = true;
    };
  }, [type, neighbourhoods]);

  useEffect(() => {
    if (moved && type) formTitle.current?.focus();
  }, [moved, type]);

  /** Editing a field clears its error; a new password also clears the confirmation's. */
  function clear(field: Field) {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      if (field === 'password') delete next.confirm;
      return next;
    });
  }

  const set = (field: keyof RegisterFormValues) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setFlow((f) => ({ ...f, account: { ...f.account, [field]: value } }));
    clear(field);
    if (field === 'phone') setErrorCode(null);
    if (field === 'email') setEmailHint(null);
  };

  function choose(next: AccountType) {
    setFlow((f) => chooseAccountType(f, next));
    setErrors({});
    setGeneral(null);
    setMoved(true);
  }

  function back() {
    setFlow((f) => backToAccountTypes(f));
    setErrors({});
    setGeneral(null);
    setMoved(true);
  }

  async function submit() {
    if (!type) return;
    const found: FieldErrors<Field> = {
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
      const onFields = apiFieldErrors(err);
      const mapped = fieldErrorsFromApi(err, API_FIELDS, "L'inscription n'a pas pu être envoyée.");
      setErrors(onFields);
      setGeneral(Object.keys(onFields).length > 0 ? null : mapped.general);
      setErrorCode(mapped.code);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <SignupDone type={done.type} restaurantName={done.name} />;

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
              if (type === 'courier' || type === 'restaurant') {
                onSignedUp(result);
                setDone({ type, name: restaurant.restaurantName.trim() });
              } else {
                onSignedIn(result);
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
          setReturned(true);
          setRegistration(null);
          setGeneral(null);
        }}
      />
    );
  }

  if (!type) return <AccountTypeChoice onChoose={choose} focusTitle={moved} />;

  const phoneTaken = errorCode === 'PHONE_ALREADY_USED' && Boolean(errors.phone);
  const neighbourhoodProps = (
    current: { neighbourhood: string; neighbourhoodOther: string },
    update: (patch: Partial<{ neighbourhood: string; neighbourhoodOther: string }>) => void,
    label: string,
  ) => ({
    label,
    options: neighbourhoods,
    value: current.neighbourhood,
    other: current.neighbourhoodOther,
    error: errors.neighbourhood,
    otherError: errors.neighbourhoodOther,
    onChange: (value: string) => {
      update({ neighbourhood: value });
      clear('neighbourhood');
    },
    onOtherChange: (value: string) => {
      update({ neighbourhoodOther: value });
      clear('neighbourhoodOther');
    },
  });

  const accountFields = (
    <>
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
        label={type === 'customer' ? 'E-mail' : 'E-mail (votre identifiant)'}
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
          if (emailHint) setFlow((f) => ({ ...f, account: { ...f.account, email: emailHint } }));
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
    </>
  );

  const terms = (checked: boolean, onChange: (value: boolean) => void) => (
    <>
      <Checkbox
        label="J'accepte les conditions d'utilisation"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
          clear('acceptTerms');
        }}
        {...(errors.acceptTerms ? { 'aria-invalid': true } : {})}
      />
      <Link className={styles['linkButton']} href="/conditions" target="_blank">
        Lire les conditions d’utilisation
      </Link>
      {errors.acceptTerms && (
        <p role="alert" className={styles['fieldError']}>
          {errors.acceptTerms}
        </p>
      )}
    </>
  );

  return (
    <form
      className={styles['panel']}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={styles['formHeader']}>
        <button type="button" className={styles['linkButton']} onClick={back}>
          ← Changer de type
        </button>
        <h2 ref={formTitle} tabIndex={-1} className={styles['stepTitle']}>
          {TITLES[type]}
        </h2>
      </div>
      {general && <Alert tone="danger">{general}</Alert>}
      {type === 'restaurant' && <h3 className={styles['groupTitle']}>Vous (responsable)</h3>}
      {accountFields}

      {type === 'courier' && (
        <>
          <fieldset className={styles['choiceGroup']}>
            <legend>Véhicule</legend>
            {VEHICLE_CHOICES.map((choice) => (
              <Radio
                key={choice.id}
                name="vehicle"
                label={choice.label}
                checked={courier.vehicle === choice.id}
                onChange={() => {
                  setCourier((c) => ({ ...c, vehicle: choice.id }));
                  clear('vehicle');
                }}
              />
            ))}
          </fieldset>
          {errors.vehicle && (
            <p role="alert" className={styles['fieldError']}>
              {errors.vehicle}
            </p>
          )}
          <NeighbourhoodField
            {...neighbourhoodProps(
              courier,
              (patch) => setCourier((c) => ({ ...c, ...patch })),
              'Quartier où vous travaillez',
            )}
          />
          <Input
            label="Date de naissance"
            type="date"
            helpText="Il faut avoir au moins 18 ans."
            value={courier.birthDate}
            onChange={(e) => {
              const birthDate = e.target.value;
              setCourier((c) => ({ ...c, birthDate }));
              clear('birthDate');
            }}
            {...(errors.birthDate ? { error: errors.birthDate } : {})}
            required
          />
          {terms(courier.acceptTerms, (acceptTerms) => setCourier((c) => ({ ...c, acceptTerms })))}
        </>
      )}

      {type === 'restaurant' && (
        <>
          <h3 className={styles['groupTitle']}>Votre restaurant</h3>
          <Input
            label="Nom du restaurant"
            placeholder="Chez Fatimé"
            value={restaurant.restaurantName}
            maxLength={80}
            onChange={(e) => {
              const restaurantName = e.target.value;
              setRestaurant((r) => ({ ...r, restaurantName }));
              clear('restaurantName');
            }}
            {...(errors.restaurantName ? { error: errors.restaurantName } : {})}
            required
          />
          <NeighbourhoodField
            {...neighbourhoodProps(
              restaurant,
              (patch) => setRestaurant((r) => ({ ...r, ...patch })),
              "Quartier (N'Djamena)",
            )}
          />
          {terms(restaurant.acceptTerms, (acceptTerms) =>
            setRestaurant((r) => ({ ...r, acceptTerms })),
          )}
        </>
      )}

      <Button type="submit" loading={busy} fullWidth>
        Créer mon compte
      </Button>
      <p className={styles['hint']}>Un code de confirmation sera envoyé à votre adresse e-mail.</p>
    </form>
  );
}

/**
 * The API's refusals on their field (SPEC-022-02 SC02, SC03, SPEC-022-09):
 * `neighbourhoodId` is « Quartier », 422 `UNDERAGE` the birth date,
 * `NEIGHBOURHOOD_UNKNOWN` the neighbourhood.
 */
function apiFieldErrors(err: unknown): FieldErrors<Field> {
  const mapped = fieldErrorsFromApi(err, API_FIELDS, '');
  const { neighbourhoodId, ...rest } = mapped.fields;
  const out: FieldErrors<Field> = {
    ...rest,
    ...(neighbourhoodId ? { neighbourhood: neighbourhoodId } : {}),
  };
  if (err instanceof ApiClientError && err.code === 'UNDERAGE') out.birthDate = err.message;
  if (err instanceof ApiClientError && err.code === 'NEIGHBOURHOOD_UNKNOWN') {
    out.neighbourhood = err.message;
  }
  return out;
}
