'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import {
  ApiClientError,
  type Address,
  type AddressInput,
  type Landmark,
  type LandmarkRelation,
  type VoiceNote,
} from '@djafat/sdk';
import {
  Badge,
  Container,
  Heading,
  Text,
  Stack,
  EmptyState,
  ErrorState,
  Skeleton,
  cx,
} from '@djafat/ui';
import { Button, Input, Textarea, Alert, Select } from '@/components/ui-client';
import { VoiceNoteRecorder } from '@/components/VoiceNoteRecorder';
import { api } from '@/lib/api';
import { isAuthenticated, clearSession } from '@/lib/auth-storage';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';

interface FormValues {
  label: string;
  recipientPhone: string;
  quartier: string;
  street: string;
  landmark: string;
  instructions: string;
  // FEAT-018
  landmarkId: string | null;
  landmarkName: string;
  landmarkRelation: LandmarkRelation;
  doorHint: string;
  coordinates: { lat: number; lng: number; accuracyM: number } | null;
}

const EMPTY_FORM: FormValues = {
  label: '',
  recipientPhone: '',
  quartier: '',
  street: '',
  landmark: '',
  instructions: '',
  landmarkId: null,
  landmarkName: '',
  landmarkRelation: 'near',
  doorHint: '',
  coordinates: null,
};

const RELATIONS: ReadonlyArray<[LandmarkRelation, string]> = [
  ['behind', 'Derrière'],
  ['in_front_of', 'Devant'],
  ['next_to', 'À côté de'],
  ['opposite', 'En face de'],
  ['near', 'Près de'],
];

/** Built field-by-field — under `exactOptionalPropertyTypes`, a key present with value `undefined` is not the same as the key being absent. */
function toInput(values: FormValues, editing: boolean): AddressInput {
  const input: { -readonly [K in keyof AddressInput]?: AddressInput[K] } = {};
  const label = values.label.trim();
  const recipientPhone = values.recipientPhone.trim();
  const quartier = values.quartier.trim();
  const street = values.street.trim();
  const landmark = values.landmark.trim();
  const instructions = values.instructions.trim();
  if (label) input.label = label;
  if (recipientPhone) input.recipientPhone = recipientPhone;
  if (quartier) input.quartier = quartier;
  if (street) input.street = street;
  if (landmark) input.landmark = landmark;
  if (instructions) input.instructions = instructions;
  // FEAT-018
  if (values.landmarkId) {
    input.landmarkId = values.landmarkId;
    input.landmarkRelation = values.landmarkRelation;
  } else if (editing) {
    input.landmarkId = null;
  }
  const doorHint = values.doorHint.trim().slice(0, 80);
  if (doorHint) input.doorHint = doorHint;
  else if (editing) input.doorHint = null;
  if (values.coordinates) {
    input.coordinates = { lat: values.coordinates.lat, lng: values.coordinates.lng };
    input.gpsAccuracyM = Math.round(values.coordinates.accuracyM);
  }
  return input;
}

function toFormValues(address: Address): FormValues {
  return {
    label: address.label ?? '',
    recipientPhone: address.recipientPhone ?? '',
    quartier: address.quartier ?? '',
    street: address.street ?? '',
    landmark: address.landmark ?? '',
    instructions: address.instructions ?? '',
    landmarkId: address.landmarkId ?? null,
    landmarkName: address.landmarkName ?? '',
    landmarkRelation: address.landmarkRelation ?? 'near',
    doorHint: address.doorHint ?? '',
    coordinates: null,
  };
}

function mapAddressError(err: ApiClientError): string {
  if (err.code === 'INVALID_LOCATION') return 'Coordonnées de localisation invalides.';
  if (err.code === 'VALIDATION_ERROR') {
    return err.message || 'Adresse invalide — vérifiez les champs saisis.';
  }
  if (err.code === 'NOT_FOUND')
    return 'Cette adresse n’existe plus — la liste va se mettre à jour.';
  return "Impossible d'enregistrer cette adresse pour le moment. Réessayez.";
}

/**
 * `/adresses` — the customer's own address book (Bloc 8, docs/29 §web).
 * Closes the gap the pre-Bloc-8 audit found: nothing let a real (non-seeded)
 * customer add a delivery address, so `/panier`'s "Commander" was a dead end
 * for anyone but a seeded account. No map/geocoding picker here (out of
 * scope, docs/29) — `quartier`/`street`/`landmark`/`instructions` are typed
 * out by hand, matching N'Djamena's landmark-first addressing (docs/09 B.1).
 */
export default function AdressesPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // FEAT-018
  const [suggestions, setSuggestions] = useState<Landmark[]>([]);
  const [locating, setLocating] = useState(false);
  const [locateMsg, setLocateMsg] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<VoiceNote | null>(null);
  const [editingHasNote, setEditingHasNote] = useState(false);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    if (!isAuthenticated()) {
      router.push('/connexion?redirect=%2Fadresses' as Route);
      return;
    }
    setState('loading');
    try {
      const list = await api.addresses.list();
      setAddresses(list);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.push('/connexion?redirect=%2Fadresses' as Route);
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetExtras() {
    setSuggestions([]);
    setLocateMsg(null);
    setPendingNote(null);
  }

  function openCreate() {
    setEditingId(null);
    setValues(EMPTY_FORM);
    setFormError(null);
    resetExtras();
    setEditingHasNote(false);
    setFormOpen(true);
  }

  function openEdit(address: Address) {
    setEditingId(address.id);
    setValues(toFormValues(address));
    setFormError(null);
    resetExtras();
    setEditingHasNote(address.hasVoiceNote === true);
    setFormOpen(true);
  }

  /** FEAT-018 — landmark suggestions as the customer types. */
  async function searchLandmarks(text: string) {
    setValues((v) => ({ ...v, landmarkName: text, landmarkId: null }));
    const seq = ++searchSeq.current;
    if (text.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    try {
      const found = await api.landmarks.search(text.trim());
      if (seq === searchSeq.current) setSuggestions(found);
    } catch {
      if (seq === searchSeq.current) setSuggestions([]);
    }
  }

  function pickLandmark(l: Landmark) {
    setValues((v) => ({ ...v, landmarkId: l.id, landmarkName: l.name }));
    setSuggestions([]);
  }

  function useMyPosition() {
    setLocateMsg(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocateMsg('Votre téléphone ne donne pas sa position.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setValues((v) => ({
          ...v,
          coordinates: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
          },
        }));
        setLocateMsg(`Position enregistrée (précision ± ${Math.round(pos.coords.accuracy)} m).`);
      },
      () => {
        setLocating(false);
        setLocateMsg('Position refusée ou indisponible.');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  async function playSavedNote() {
    if (!editingId) return;
    try {
      const note = await api.addresses.getVoiceNote(editingId);
      if (note) void new Audio(`data:${note.mime};base64,${note.dataBase64}`).play();
    } catch {
      setFormError('Impossible de lire la note vocale.');
    }
  }

  async function removeSavedNote() {
    if (!editingId) return;
    try {
      await api.addresses.removeVoiceNote(editingId);
      setEditingHasNote(false);
      await load();
    } catch {
      setFormError('Impossible de supprimer la note vocale.');
    }
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  async function submitForm() {
    setSaving(true);
    setFormError(null);
    try {
      const saved = editingId
        ? await api.addresses.update(editingId, toInput(values, true))
        : await api.addresses.create(toInput(values, false));
      if (pendingNote) {
        try {
          await api.addresses.setVoiceNote(saved.id, pendingNote);
        } catch {
          setListError('Adresse enregistrée, mais la note vocale n’a pas pu être envoyée.');
        }
        setPendingNote(null);
      }
      setFormOpen(false);
      setEditingId(null);
      await load();
    } catch (err) {
      setFormError(err instanceof ApiClientError ? mapAddressError(err) : 'Adresse invalide.');
    } finally {
      setSaving(false);
    }
  }

  async function removeAddress(id: string) {
    setBusyId(id);
    setListError(null);
    try {
      await api.addresses.remove(id);
      await load();
    } catch (err) {
      setListError(
        err instanceof ApiClientError ? mapAddressError(err) : 'Suppression impossible.',
      );
    } finally {
      setBusyId(null);
    }
  }

  async function setDefault(id: string) {
    setBusyId(id);
    setListError(null);
    try {
      await api.addresses.setDefault(id);
      await load();
    } catch (err) {
      setListError(err instanceof ApiClientError ? mapAddressError(err) : 'Opération impossible.');
    } finally {
      setBusyId(null);
    }
  }

  if (state === 'loading') {
    return (
      <Container
        as="main"
        maxWidth={640}
        className={cx(styles['main'])}
        aria-busy="true"
        aria-label="Chargement de vos adresses"
      >
        <Skeleton width={200} height={28} />
        <Skeleton height={100} radius="12px" className={cx(styles['skeletonRow'])} />
        <Skeleton height={100} radius="12px" className={cx(styles['skeletonRow'])} />
      </Container>
    );
  }

  if (state === 'error') {
    return (
      <Container as="main" maxWidth={640} className={cx(styles['main'])}>
        <ErrorState
          title="Impossible de charger vos adresses"
          action={<Button onClick={() => void load()}>Réessayer</Button>}
        />
      </Container>
    );
  }

  return (
    <Container as="main" maxWidth={640} className={cx(styles['main'])}>
      <Stack gap="lg">
        <div className={cx(styles['header'])}>
          <Heading level={1}>Mes adresses</Heading>
          {!formOpen && <Button onClick={openCreate}>Ajouter une adresse</Button>}
        </div>

        {listError && <Alert tone="danger">{listError}</Alert>}

        {formOpen && (
          <form
            className={cx(styles['form'])}
            onSubmit={(e) => {
              e.preventDefault();
              void submitForm();
            }}
          >
            <Stack gap="md">
              <Heading level={2} size="h3">
                {editingId ? 'Modifier l’adresse' : 'Nouvelle adresse'}
              </Heading>
              {formError && <Alert tone="danger">{formError}</Alert>}
              <Input
                label="Nom (ex. Domicile, Bureau)"
                value={values.label}
                onChange={(e) => setValues((v) => ({ ...v, label: e.target.value }))}
                maxLength={100}
                autoFocus
              />
              <Input
                label="Téléphone du destinataire"
                type="tel"
                placeholder="+23566000000"
                value={values.recipientPhone}
                onChange={(e) => setValues((v) => ({ ...v, recipientPhone: e.target.value }))}
              />
              <Input
                label="Quartier"
                value={values.quartier}
                onChange={(e) => setValues((v) => ({ ...v, quartier: e.target.value }))}
              />
              <Input
                label="Rue"
                value={values.street}
                onChange={(e) => setValues((v) => ({ ...v, street: e.target.value }))}
              />
              <div className={cx(styles['landmarkBox'])}>
                <Input
                  label="Repère proche"
                  helpText="Tapez un lieu connu : mosquée, marché, rond-point…"
                  value={values.landmarkName}
                  onChange={(e) => void searchLandmarks(e.target.value)}
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-controls="landmark-suggestions"
                />
                {suggestions.length > 0 && (
                  <ul
                    id="landmark-suggestions"
                    className={cx(styles['suggestions'])}
                    aria-label="Repères proposés"
                  >
                    {suggestions.map((l) => (
                      <li key={l.id}>
                        <button
                          type="button"
                          className={cx(styles['suggestion'])}
                          onClick={() => pickLandmark(l)}
                        >
                          {l.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {values.landmarkId && (
                  <Text size="small" tone="secondary">
                    ✓ Repère choisi : {values.landmarkName}
                  </Text>
                )}
              </div>
              {values.landmarkId && (
                <Select
                  label="Votre maison par rapport au repère"
                  value={values.landmarkRelation}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      landmarkRelation: e.target.value as LandmarkRelation,
                    }))
                  }
                >
                  {RELATIONS.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </Select>
              )}
              <Input
                label="Indication pour le portail"
                placeholder="ex. portail bleu"
                value={values.doorHint}
                maxLength={80}
                onChange={(e) => setValues((v) => ({ ...v, doorHint: e.target.value }))}
              />
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  loading={locating}
                  onClick={useMyPosition}
                >
                  📍 Utiliser ma position
                </Button>
                {locateMsg && (
                  <Text size="small" tone="secondary" aria-live="polite">
                    {locateMsg}
                  </Text>
                )}
              </div>
              <Input
                label="Autre précision (facultatif)"
                helpText="Ce que vous diriez au livreur au téléphone."
                value={values.landmark}
                onChange={(e) => setValues((v) => ({ ...v, landmark: e.target.value }))}
              />
              <VoiceNoteRecorder
                hasSaved={editingHasNote}
                pending={pendingNote}
                onRecorded={setPendingNote}
                onRemove={() => void removeSavedNote()}
                onPlaySaved={() => void playSavedNote()}
              />
              <Textarea
                label="Instructions de livraison"
                value={values.instructions}
                onChange={(e) => setValues((v) => ({ ...v, instructions: e.target.value }))}
                rows={3}
              />
              <div className={cx(styles['formActions'])}>
                <Button type="submit" loading={saving}>
                  {editingId ? 'Enregistrer' : 'Ajouter'}
                </Button>
                <Button type="button" variant="ghost" onClick={closeForm} disabled={saving}>
                  Annuler
                </Button>
              </div>
            </Stack>
          </form>
        )}

        {addresses.length === 0 && !formOpen ? (
          <EmptyState
            icon="📍"
            title="Aucune adresse enregistrée"
            message="Ajoutez une adresse de livraison pour pouvoir passer commande."
            action={<Button onClick={openCreate}>Ajouter une adresse</Button>}
          />
        ) : (
          <ul className={cx(styles['list'])}>
            {addresses.map((address) => {
              const isBusy = busyId === address.id;
              const details = [address.quartier, address.street, address.cityName]
                .filter(Boolean)
                .join(', ');
              return (
                <li key={address.id} className={cx(styles['item'])}>
                  <div className={cx(styles['itemHeader'])}>
                    <Text weight="bold">{address.label ?? 'Sans nom'}</Text>
                    {address.isDefault && <Badge tone="success">Par défaut</Badge>}
                  </div>
                  <Text size="small" tone="secondary">
                    {details || 'Aucun détail de rue renseigné'}
                  </Text>
                  {address.deliveryHint && <Text size="small">📍 {address.deliveryHint}</Text>}
                  {address.landmark && (
                    <Text size="small" tone="secondary">
                      Repère : {address.landmark}
                    </Text>
                  )}
                  {(address.learnedPoint || address.hasVoiceNote) && (
                    <div className={cx(styles['badges'])}>
                      {address.learnedPoint && (
                        <Badge tone="success">
                          Point confirmé par {address.learnedPoint.count} livraison
                          {address.learnedPoint.count > 1 ? 's' : ''}
                        </Badge>
                      )}
                      {address.hasVoiceNote && <Badge>🎙 Note vocale</Badge>}
                    </div>
                  )}
                  <div className={cx(styles['itemActions'])}>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEdit(address)}
                      disabled={isBusy}
                    >
                      Modifier
                    </Button>
                    {!address.isDefault && (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={isBusy}
                        onClick={() => void setDefault(address.id)}
                      >
                        Définir par défaut
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={isBusy}
                      onClick={() => void removeAddress(address.id)}
                    >
                      Supprimer
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Stack>
    </Container>
  );
}
