'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { ApiClientError, type Address, type AddressInput } from '@djafat/sdk';
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
import { Button, Input, Textarea, Alert } from '@/components/ui-client';
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
}

const EMPTY_FORM: FormValues = {
  label: '',
  recipientPhone: '',
  quartier: '',
  street: '',
  landmark: '',
  instructions: '',
};

/** Built field-by-field — under `exactOptionalPropertyTypes`, a key present with value `undefined` is not the same as the key being absent. */
function toInput(values: FormValues): AddressInput {
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

  function openCreate() {
    setEditingId(null);
    setValues(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(address: Address) {
    setEditingId(address.id);
    setValues(toFormValues(address));
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setEditingId(null);
  }

  async function submitForm() {
    setSaving(true);
    setFormError(null);
    try {
      if (editingId) {
        await api.addresses.update(editingId, toInput(values));
      } else {
        await api.addresses.create(toInput(values));
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
              <Input
                label="Point de repère"
                helpText="Un repère connu à proximité (ex. près du marché de Klemat)."
                value={values.landmark}
                onChange={(e) => setValues((v) => ({ ...v, landmark: e.target.value }))}
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
                  {address.landmark && (
                    <Text size="small" tone="secondary">
                      Repère : {address.landmark}
                    </Text>
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
