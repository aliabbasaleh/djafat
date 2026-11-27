'use client';

import { useEffect, useRef, useState } from 'react';
import { restaurantLocationErrors, restaurantLocationRequest, type FieldErrors } from '@djafat/sdk';
import { Heading, Text, Stack, Inline, Skeleton, ErrorState } from '@djafat/ui';
import { Alert, Button, Input } from '@/components/ui-client';
import { LocationMap, type MapPoint } from '@/components/LocationMap';
import { StepBackLink } from '@/components/StepBackLink';
import { api } from '@/lib/api';
import {
  UNDER_REVIEW_TEXT,
  errorText,
  underReview,
  useRestaurantApplication,
} from '@/lib/application';
import { focusField, focusFirstInvalid } from '@/lib/focus';
import { cx } from '@djafat/ui';
import styles from '../steps.module.css';

type Field = 'point' | 'addressText' | 'landmark';

/**
 * FEAT-022 (SPEC-022-05 R1, step 1): « Emplacement » — the point on the map,
 * the address and a landmark. The point is required even with the address
 * typed; while DJAFAT checks the application, the step reads only (R5).
 */
export default function LocationPage() {
  const { application, setApplication, reload, failed } = useRestaurantApplication();
  const [point, setPoint] = useState<MapPoint | null>(null);
  const [addressText, setAddressText] = useState('');
  const [landmark, setLandmark] = useState('');
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const started = useRef(false);
  const form = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (!application || started.current) return;
    started.current = true;
    const { lat, lng } = application.location;
    setPoint(lat !== null && lng !== null ? { lat, lng } : null);
    setAddressText(application.location.addressText ?? '');
    setLandmark(application.location.landmark ?? '');
  }, [application]);

  const readOnly = underReview(application);

  function clearPointError() {
    setErrors(({ point: _point, ...rest }) => rest);
  }

  function useMyPosition() {
    setMessage(null);
    if (!('geolocation' in navigator)) {
      setErrors((e) => ({
        ...e,
        point: 'Ce navigateur ne donne pas la position : touchez la carte.',
      }));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setPoint({ lat: position.coords.latitude, lng: position.coords.longitude });
        clearPointError();
      },
      () => {
        setLocating(false);
        setErrors((e) => ({
          ...e,
          point: 'Position introuvable (autorisation refusée ?) : touchez la carte à la place.',
        }));
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function save() {
    setMessage(null);
    const values = { point, addressText, landmark };
    const found = restaurantLocationErrors(values);
    setErrors(found);
    if (found.point) return focusField(form.current, '#locate-button');
    if (Object.keys(found).length > 0) return focusFirstInvalid(form.current);
    setSaving(true);
    try {
      setApplication(
        await api.restaurant.application.updateLocation(restaurantLocationRequest(values)),
      );
      setMessage({ tone: 'success', text: 'Emplacement enregistré.' });
    } catch (err) {
      setMessage({
        tone: 'danger',
        text: errorText(err, "L'emplacement n'a pas pu être enregistré."),
      });
    } finally {
      setSaving(false);
    }
  }

  if (application === undefined) {
    return (
      <Stack gap="sm" aria-busy="true" aria-label="Chargement de l'emplacement">
        <Skeleton height={40} />
        <Skeleton height={360} radius="12px" />
      </Stack>
    );
  }
  if (failed) {
    return (
      <ErrorState
        title="Impossible de charger l'emplacement"
        action={<Button onClick={() => void reload()}>Réessayer</Button>}
      />
    );
  }
  if (application === null) {
    return (
      <ErrorState
        title="Pas d'étapes pour ce restaurant"
        message="Ce restaurant a été inscrit par DJAFAT : son adresse se change dans le profil."
        action={<Button href="/restaurant/profile">Profil</Button>}
      />
    );
  }

  return (
    <Stack gap="lg">
      <StepBackLink />
      <Heading level={1}>1. Emplacement</Heading>
      <Text tone="secondary">
        Placez le point exact de votre restaurant : les livreurs y viendront chercher les commandes.
      </Text>
      {readOnly && <Alert tone="info">{UNDER_REVIEW_TEXT}</Alert>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <Stack gap="md">
          <LocationMap
            point={point}
            readOnly={readOnly}
            label="Carte : touchez l'endroit de votre restaurant, puis faites glisser le point si besoin"
            onChange={(next) => {
              setPoint(next);
              clearPointError();
            }}
          />
          <Inline gap="md" align="center" wrap>
            {!readOnly && (
              <Button
                id="locate-button"
                type="button"
                variant="secondary"
                size="sm"
                loading={locating}
                aria-describedby={errors.point ? 'point-error' : undefined}
                onClick={useMyPosition}
              >
                Utiliser ma position
              </Button>
            )}
            <Text size="small" tone="secondary">
              {point
                ? `Point placé (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}).`
                : 'Aucun point placé pour le moment.'}
            </Text>
          </Inline>
          {errors.point && (
            <p id="point-error" role="alert" className={cx(styles['fieldError'])}>
              {errors.point}
            </p>
          )}
          <Input
            label="Adresse"
            placeholder="Avenue Charles de Gaulle, Klémat"
            value={addressText}
            onChange={(e) => setAddressText(e.target.value)}
            {...(errors.addressText ? { error: errors.addressText } : {})}
            disabled={readOnly}
            required
          />
          <Input
            label="Repère (facultatif)"
            placeholder="En face de la pharmacie du Centre"
            helpText="Ce qui aide un livreur à trouver l'entrée."
            value={landmark}
            onChange={(e) => setLandmark(e.target.value)}
            {...(errors.landmark ? { error: errors.landmark } : {})}
            disabled={readOnly}
          />
          {!readOnly && (
            <div>
              <Button type="submit" loading={saving}>
                Enregistrer l'emplacement
              </Button>
            </div>
          )}
        </Stack>
      </form>
    </Stack>
  );
}
