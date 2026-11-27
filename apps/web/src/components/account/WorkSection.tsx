'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ndjamenaDate } from '@djafat/core';
import type { MeProfile } from '@djafat/sdk';
import { Stack, Text, cx } from '@djafat/ui';
import { Alert, Button, Checkbox, Input, Radio } from '@/components/ui-client';
import { api, appUrl } from '@/lib/api';
import {
  VEHICLE_CHOICES,
  courierSignupFields,
  restaurantSignupFields,
  signupDoneText,
  signupFieldErrors,
  validateCourierFields,
  validateRestaurantFields,
  type CourierFieldValues,
  type FieldErrors,
  type RestaurantFieldValues,
} from '@/lib/account';
import { NeighbourhoodField, type NeighbourhoodOption } from './NeighbourhoodField';
import { focusFirstInvalid } from './focus';
import styles from './account.module.css';

type Kind = 'courier' | 'restaurant';
type Field =
  | 'vehicle'
  | 'neighbourhood'
  | 'neighbourhoodOther'
  | 'birthDate'
  | 'acceptTerms'
  | 'restaurantName';

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

/**
 * « Travailler avec DJAFAT » in « Mon profil » (FEAT-022, SPEC-022-08): « Devenir
 * livreur » and « Inscrire mon restaurant » add the role to THIS account — same
 * e-mail, same phone — with the type's fields. A role already held shows the
 * way to its app instead (R3); a restaurant owner has one restaurant (R5).
 * `initial` opens a form on arrival (`/profil?devenir=livreur`).
 */
export function WorkSection({
  me,
  initial,
  onUpdated,
  cardClassName,
  labelClassName,
  mutedClassName,
}: {
  readonly me: MeProfile;
  readonly initial: Kind | null;
  readonly onUpdated: (profile: MeProfile) => void;
  readonly cardClassName: string;
  readonly labelClassName: string;
  readonly mutedClassName: string;
}) {
  const [open, setOpen] = useState<Kind | null>(initial);
  const [courier, setCourier] = useState<CourierFieldValues>(EMPTY_COURIER);
  const [restaurant, setRestaurant] = useState<RestaurantFieldValues>(EMPTY_RESTAURANT);
  const [neighbourhoods, setNeighbourhoods] = useState<NeighbourhoodOption[] | null>(null);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ kind: Kind; name: string } | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const isCourier = me.roles.includes('courier');
  const isOwner = me.roles.includes('restaurant_owner');
  // SPEC-022-08 R5 (v4): one account, one restaurant — staff register theirs with another account.
  const isStaff = me.roles.includes('restaurant_staff');

  useEffect(() => {
    if (!open || neighbourhoods !== null) return;
    let cancelled = false;
    api.auth
      .neighbourhoods()
      .then((res) => !cancelled && setNeighbourhoods(res.neighbourhoods))
      .catch(() => !cancelled && setNeighbourhoods([]));
    return () => {
      cancelled = true;
    };
  }, [open, neighbourhoods]);

  useEffect(() => {
    if (open) title.current?.focus();
  }, [open]);

  function clear(field: Field) {
    setErrors(({ [field]: _gone, ...rest }) => rest);
  }

  async function submit(kind: Kind) {
    setError(null);
    const found =
      kind === 'courier'
        ? validateCourierFields(courier, ndjamenaDate(new Date()))
        : validateRestaurantFields(restaurant);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const profile =
        kind === 'courier'
          ? await api.auth.becomeCourier(courierSignupFields(courier))
          : await api.auth.registerRestaurant(restaurantSignupFields(restaurant));
      onUpdated(profile);
      setDone({ kind, name: restaurant.restaurantName.trim() });
      setOpen(null);
    } catch (err) {
      const mapped = signupFieldErrors(err, "L'envoi n'a pas abouti. Réessayez.");
      setErrors(mapped.fields);
      setError(mapped.general);
      focusFirstInvalid(formRef.current);
    } finally {
      setBusy(false);
    }
  }

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

  const neighbourhood = (
    current: { neighbourhood: string; neighbourhoodOther: string },
    update: (patch: Partial<{ neighbourhood: string; neighbourhoodOther: string }>) => void,
    label: string,
  ) => (
    <NeighbourhoodField
      label={label}
      options={neighbourhoods}
      value={current.neighbourhood}
      other={current.neighbourhoodOther}
      error={errors.neighbourhood}
      otherError={errors.neighbourhoodOther}
      onChange={(value) => {
        update({ neighbourhood: value });
        clear('neighbourhood');
      }}
      onOtherChange={(value) => {
        update({ neighbourhoodOther: value });
        clear('neighbourhoodOther');
      }}
    />
  );

  const courierLink = appUrl('courier');
  const consoleLink = appUrl('restaurant');

  return (
    <section className={cx(cardClassName)} aria-labelledby="work-title">
      <Stack gap="sm">
        <p id="work-title" className={cx(labelClassName)}>
          Travailler avec DJAFAT
        </p>
        {done && (
          // The success box draws its own ✅: the title goes without it.
          <Alert tone="success">
            {signupDoneText(done.kind, done.name).title.replace(/^✅\s*/, '')} —{' '}
            {signupDoneText(done.kind, done.name).text}
          </Alert>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        {!me.emailVerified && (
          <p className={cx(mutedClassName)}>
            Pour devenir livreur ou inscrire un restaurant, confirmez d’abord votre adresse e-mail
            (plus haut).
          </p>
        )}

        {isCourier ? (
          courierLink ? (
            <a className={styles['linkButton']} href={courierLink}>
              Mon dossier de livreur
            </a>
          ) : (
            <Text>Vous êtes livreur : ouvrez l’application DJAFAT Livreur.</Text>
          )
        ) : open === 'courier' ? (
          <form
            ref={formRef}
            className={styles['panel']}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit('courier');
            }}
          >
            <h2 ref={title} tabIndex={-1} className={styles['stepTitle']}>
              Devenir livreur
            </h2>
            <fieldset className={styles['choiceGroup']}>
              <legend>Véhicule</legend>
              {VEHICLE_CHOICES.map((choice) => (
                <Radio
                  key={choice.id}
                  name="profile-vehicle"
                  label={choice.label}
                  checked={courier.vehicle === choice.id}
                  {...(errors.vehicle ? { 'aria-invalid': true } : {})}
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
            {neighbourhood(
              courier,
              (patch) => setCourier((c) => ({ ...c, ...patch })),
              'Quartier où vous travaillez',
            )}
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
            {terms(courier.acceptTerms, (acceptTerms) =>
              setCourier((c) => ({ ...c, acceptTerms })),
            )}
            <Button type="submit" loading={busy} fullWidth>
              Devenir livreur
            </Button>
            <Button type="button" variant="ghost" fullWidth onClick={() => setOpen(null)}>
              Annuler
            </Button>
          </form>
        ) : (
          open === null && (
            <Button type="button" variant="secondary" onClick={() => setOpen('courier')}>
              Devenir livreur
            </Button>
          )
        )}

        {isOwner ? (
          consoleLink ? (
            <a className={styles['linkButton']} href={consoleLink}>
              Mon restaurant
            </a>
          ) : (
            <Text>Vous avez un restaurant : ouvrez la console restaurant.</Text>
          )
        ) : isStaff ? (
          <Text>
            Ce compte fait partie de l&apos;équipe d&apos;un restaurant : inscrivez le vôtre avec un
            autre compte.
          </Text>
        ) : open === 'restaurant' ? (
          <form
            ref={formRef}
            className={styles['panel']}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit('restaurant');
            }}
          >
            <h2 ref={title} tabIndex={-1} className={styles['stepTitle']}>
              Inscrire mon restaurant
            </h2>
            <Input
              label="Nom du restaurant"
              placeholder="Chez Fatimé"
              maxLength={80}
              value={restaurant.restaurantName}
              onChange={(e) => {
                const restaurantName = e.target.value;
                setRestaurant((r) => ({ ...r, restaurantName }));
                clear('restaurantName');
              }}
              {...(errors.restaurantName ? { error: errors.restaurantName } : {})}
              required
            />
            {neighbourhood(
              restaurant,
              (patch) => setRestaurant((r) => ({ ...r, ...patch })),
              "Quartier (N'Djamena)",
            )}
            {terms(restaurant.acceptTerms, (acceptTerms) =>
              setRestaurant((r) => ({ ...r, acceptTerms })),
            )}
            <Button type="submit" loading={busy} fullWidth>
              Inscrire mon restaurant
            </Button>
            <Button type="button" variant="ghost" fullWidth onClick={() => setOpen(null)}>
              Annuler
            </Button>
          </form>
        ) : (
          open === null && (
            <Button type="button" variant="secondary" onClick={() => setOpen('restaurant')}>
              Inscrire mon restaurant
            </Button>
          )
        )}
      </Stack>
    </section>
  );
}
