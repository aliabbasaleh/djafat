import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import {
  COURIER_VEHICLES,
  MOBILE_MONEY_PROVIDERS,
  type CourierDocumentKind,
  type CourierItem,
  type MobileMoneyProvider,
} from '@djafat/core';
import { ApiClientError, type CourierApplication } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { Badge } from '../../components/Badge';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import {
  ITEM_LABELS,
  PHOTO_LABELS,
  PROVIDER_LABELS,
  VEHICLE_LABELS,
  VEHICLE_MARKS,
  applicationBanner,
  applicationErrorMessage,
  canEdit,
  canSubmit,
  itemState,
  photosOfItem,
  pickedPhoto,
} from '../../lib/application';

const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  // Smaller before sending (SPEC-022-04: 5 MB at most, no re-encoding on the server).
  quality: 0.6,
  exif: false,
  // iPhone photos as JPEG, not HEIC.
  preferredAssetRepresentationMode:
    ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
};

/**
 * FEAT-022 (SPEC-022-06, FEAT-022-VIS05): « Avant votre première course ».
 * A courier who signed up fills the items of their vehicle, sends them for
 * validation, and cannot go online until DJAFAT approved them. Every item
 * says its state in words; the photos come from the camera or the gallery
 * (a choice sheet).
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const [application, setApplication] = useState<CourierApplication | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<CourierItem | 'vehicle' | null>(null);
  const [sheetFor, setSheetFor] = useState<CourierDocumentKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const mine = await api.courier.application.get();
      setFailed(false);
      if (mine.status === 'approved') {
        router.replace('/(app)/home');
        return;
      }
      setApplication(mine);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await signOut();
        return;
      }
      // No application: a courier created by the team works as before (SPEC-022-06 R5).
      if (err instanceof ApiClientError && err.code === 'APPLICATION_NOT_FOUND') {
        router.replace('/(app)/home');
        return;
      }
      setFailed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same convention as home.tsx (FU-REACT-01): `signOut` and `router` are stable for the screen's life.
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(change: () => Promise<CourierApplication>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setApplication(await change());
      return true;
    } catch (err) {
      setError(applicationErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function pick(kind: CourierDocumentKind, source: 'camera' | 'library') {
    setSheetFor(null);
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError(
          'Autorisez l’appareil photo dans les réglages du téléphone, ou choisissez une photo de la galerie.',
        );
        return;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;
    await run(async () => api.courier.application.uploadPhoto(kind, await pickedPhoto(asset.uri)));
  }

  if (failed) {
    return (
      <Screen scroll={false}>
        <Text style={styles.subtle}>Connexion au serveur impossible.</Text>
        <BigButton label="Réessayer" onPress={() => void load()} />
      </Screen>
    );
  }
  if (!application) {
    return (
      <Screen scroll={false}>
        <Text style={styles.subtle}>Chargement…</Text>
      </Screen>
    );
  }

  const editable = canEdit(application);
  const banner = applicationBanner(application);

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.brand}>DJAFAT Livreur</Text>
        <BigButton label="Déconnexion" variant="ghost" onPress={() => void signOut()} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        Avant votre première course
      </Text>
      {user?.fullName ? <Text style={styles.subtle}>{user.fullName}</Text> : null}
      <View style={styles.banner}>
        <Badge tone={banner.tone} label={banner.text} />
      </View>

      {application.vehicle ? (
        <ItemRow
          title={`Véhicule : ${VEHICLE_LABELS[application.vehicle]}`}
          state={editable ? 'Changer' : ''}
          mark={VEHICLE_MARKS[application.vehicle]}
          onPress={editable ? () => setOpen(open === 'vehicle' ? null : 'vehicle') : undefined}
        />
      ) : null}
      {open === 'vehicle' && editable ? (
        <View style={styles.panel}>
          <View style={styles.choices}>
            {COURIER_VEHICLES.map((vehicle) => (
              <Choice
                key={vehicle}
                label={VEHICLE_LABELS[vehicle]}
                selected={application.vehicle === vehicle}
                onPress={() =>
                  void run(() => api.courier.application.update({ vehicle })).then(
                    (ok) => ok && setOpen(null),
                  )
                }
              />
            ))}
          </View>
          <Text style={styles.note}>À vélo ou à pied : ni permis ni papiers du véhicule.</Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {application.items.map(({ item, done }) => {
          const label = ITEM_LABELS[item];
          const state = itemState(done);
          return (
            <View key={item}>
              <ItemRow
                title={label.title}
                note={label.note}
                mark={state.mark}
                state={state.words}
                onPress={editable ? () => setOpen(open === item ? null : item) : undefined}
              />
              {open === item && editable ? (
                <ItemEditor
                  item={item}
                  application={application}
                  busy={busy}
                  onPhoto={(kind) => setSheetFor(kind)}
                  onSave={(change) =>
                    void run(() => api.courier.application.update(change)).then(
                      (ok) => ok && setOpen(null),
                    )
                  }
                />
              ) : null}
            </View>
          );
        })}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {editable ? (
        <BigButton
          label="Envoyer pour validation"
          onPress={() => void run(() => api.courier.application.submit())}
          disabled={!canSubmit(application)}
          loading={busy}
        />
      ) : (
        <BigButton label="Actualiser" variant="secondary" onPress={() => void load()} />
      )}

      <View style={styles.online}>
        <BigButton label="En ligne" variant="secondary" disabled onPress={() => undefined} />
        <Text style={styles.note}>Impossible tant que DJAFAT ne vous a pas validé.</Text>
      </View>

      <Modal
        visible={sheetFor !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetFor(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {sheetFor ? PHOTO_LABELS[sheetFor] : ''}
            </Text>
            <BigButton
              label="Prendre une photo"
              onPress={() => sheetFor && void pick(sheetFor, 'camera')}
            />
            <BigButton
              label="Choisir dans la galerie"
              variant="secondary"
              onPress={() => sheetFor && void pick(sheetFor, 'library')}
            />
            <BigButton label="Annuler" variant="ghost" onPress={() => setSheetFor(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function ItemRow({
  title,
  note,
  mark,
  state,
  onPress,
}: {
  title: string;
  note?: string | undefined;
  mark: string;
  state: string;
  onPress?: (() => void) | undefined;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}${state ? ` : ${state}` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress ? styles.pressed : null]}
    >
      <Text style={styles.mark} importantForAccessibility="no">
        {mark}
      </Text>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {note ? <Text style={styles.note}>({note})</Text> : null}
      </View>
      {state ? <Text style={styles.rowState}>{state}</Text> : null}
    </Pressable>
  );
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.choice, selected ? styles.choiceSelected : null]}
    >
      <Text style={[styles.choiceLabel, selected ? styles.choiceLabelSelected : null]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ItemEditor({
  item,
  application,
  busy,
  onPhoto,
  onSave,
}: {
  item: CourierItem;
  application: CourierApplication;
  busy: boolean;
  onPhoto: (kind: CourierDocumentKind) => void;
  onSave: (change: Parameters<typeof api.courier.application.update>[0]) => void;
}) {
  const [provider, setProvider] = useState<MobileMoneyProvider>(
    application.mobileMoney?.provider ?? 'airtel',
  );
  const [number, setNumber] = useState(application.mobileMoney?.number ?? '');
  const [name, setName] = useState(application.emergencyContact?.name ?? '');
  const [phone, setPhone] = useState(application.emergencyContact?.phone ?? '');

  if (item === 'mobile_money') {
    return (
      <View style={styles.panel}>
        <View style={styles.choices}>
          {MOBILE_MONEY_PROVIDERS.map((p) => (
            <Choice
              key={p}
              label={PROVIDER_LABELS[p]}
              selected={provider === p}
              onPress={() => setProvider(p)}
            />
          ))}
        </View>
        <Text style={styles.label}>Numéro</Text>
        <TextInput
          accessibilityLabel="Numéro Mobile Money"
          style={styles.input}
          value={number}
          onChangeText={setNumber}
          keyboardType="phone-pad"
          placeholder="66 12 34 56"
          placeholderTextColor={tokens.color.text.muted}
        />
        <BigButton
          label="Enregistrer"
          loading={busy}
          onPress={() => onSave({ mobileMoney: { provider, number } })}
        />
      </View>
    );
  }
  if (item === 'emergency_contact') {
    return (
      <View style={styles.panel}>
        <Text style={styles.label}>Nom de la personne à prévenir</Text>
        <TextInput
          accessibilityLabel="Nom de la personne à prévenir"
          style={styles.input}
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Text style={styles.label}>Son téléphone</Text>
        <TextInput
          accessibilityLabel="Téléphone de la personne à prévenir"
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="99 12 34 56"
          placeholderTextColor={tokens.color.text.muted}
        />
        <BigButton
          label="Enregistrer"
          loading={busy}
          onPress={() => onSave({ emergencyContact: { name, phone } })}
        />
      </View>
    );
  }
  return (
    <View style={styles.panel}>
      {photosOfItem(application, item).map((photo) => (
        <ItemRow
          key={photo.kind}
          title={PHOTO_LABELS[photo.kind]}
          mark={photo.uploaded ? '✅' : '📷'}
          state={photo.uploaded ? 'Remplacer' : 'Ajouter'}
          onPress={busy ? undefined : () => onPhoto(photo.kind)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space['2'],
  },
  brand: { fontSize: tokens.type.size.body, fontWeight: '700', color: tokens.color.text.secondary },
  title: { fontSize: tokens.type.size.h1, fontWeight: '700', color: tokens.color.text.primary },
  subtle: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  banner: { marginVertical: tokens.space['3'] },
  list: { gap: tokens.space['2'], marginVertical: tokens.space['3'] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: tokens.space['3'],
    minHeight: 56,
    paddingHorizontal: tokens.space['3'],
    paddingVertical: tokens.space['2'],
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.bg.surface,
  },
  pressed: { opacity: 0.85 },
  mark: { fontSize: tokens.type.size.h2 },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: tokens.type.size.body,
    fontWeight: '600',
    color: tokens.color.text.primary,
  },
  rowState: { fontSize: tokens.type.size.label, color: tokens.color.text.secondary },
  note: { fontSize: tokens.type.size.label, color: tokens.color.text.muted },
  panel: {
    gap: tokens.space['2'],
    padding: tokens.space['3'],
    marginTop: tokens.space['1'],
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border.default,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: tokens.space['2'] },
  choice: {
    minHeight: 48,
    paddingHorizontal: tokens.space['4'],
    justifyContent: 'center',
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border.strong,
    backgroundColor: tokens.color.bg.surface,
  },
  choiceSelected: {
    backgroundColor: tokens.color.brand.primary,
    borderColor: tokens.color.brand.primary,
  },
  choiceLabel: {
    fontSize: tokens.type.size.body,
    fontWeight: '600',
    color: tokens.color.text.primary,
  },
  choiceLabelSelected: { color: tokens.color.brand.onPrimary },
  label: { fontSize: tokens.type.size.label, color: tokens.color.text.secondary },
  input: {
    minHeight: 48,
    paddingHorizontal: tokens.space['3'],
    borderRadius: tokens.radius.md,
    borderWidth: 1,
    borderColor: tokens.color.border.strong,
    backgroundColor: tokens.color.bg.surface,
    color: tokens.color.text.primary,
    fontSize: tokens.type.size.body,
  },
  error: {
    color: tokens.color.state.danger,
    fontSize: tokens.type.size.body,
    marginBottom: tokens.space['3'],
  },
  online: { marginTop: tokens.space['4'], gap: tokens.space['2'], alignItems: 'stretch' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    gap: tokens.space['3'],
    padding: tokens.space['4'],
    paddingBottom: tokens.space['6'],
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    backgroundColor: tokens.color.bg.canvas,
  },
  sheetTitle: {
    fontSize: tokens.type.size.h2,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
});
