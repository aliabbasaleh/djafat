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
  type CourierVehicle,
  type MobileMoneyProvider,
} from '@djafat/core';
import {
  ApiClientError,
  personNameError,
  phoneFieldError,
  phoneForField,
  type CourierApplication,
} from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { Badge } from '../../components/Badge';
import { PhoneInput } from '../../components/PhoneInput';
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
  vehicleChangeDropsPhotos,
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
  /** R3: a switch to a bicycle or on foot that would delete photos already sent waits for « Oui ». */
  const [confirmVehicle, setConfirmVehicle] = useState<CourierVehicle | null>(null);
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
  }, [router, signOut]);

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

  function changeVehicle(vehicle: CourierVehicle) {
    setConfirmVehicle(null);
    void run(() => api.courier.application.update({ vehicle })).then((ok) => ok && setOpen(null));
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

      <ItemRow
        title={`Véhicule : ${application.vehicle ? VEHICLE_LABELS[application.vehicle] : 'à choisir'}`}
        state={editable ? 'Changer' : ''}
        mark={application.vehicle ? VEHICLE_MARKS[application.vehicle] : '❔'}
        onPress={editable ? () => setOpen(open === 'vehicle' ? null : 'vehicle') : undefined}
      />
      {open === 'vehicle' && editable ? (
        <View style={styles.panel}>
          <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel="Véhicule">
            {COURIER_VEHICLES.map((vehicle) => (
              <Choice
                key={vehicle}
                label={VEHICLE_LABELS[vehicle]}
                selected={application.vehicle === vehicle}
                onPress={() =>
                  vehicleChangeDropsPhotos(application, vehicle)
                    ? setConfirmVehicle(vehicle)
                    : changeVehicle(vehicle)
                }
              />
            ))}
          </View>
          {confirmVehicle ? (
            <View style={styles.confirm} accessibilityRole="alert" aria-live="polite">
              <Text style={styles.rowTitle}>Passer à {VEHICLE_LABELS[confirmVehicle]} ?</Text>
              <Text style={styles.note}>
                Les photos du permis et des papiers du véhicule déjà envoyées seront supprimées.
              </Text>
              <BigButton
                label={`Oui, passer à ${VEHICLE_LABELS[confirmVehicle]}`}
                variant="danger"
                loading={busy}
                onPress={() => changeVehicle(confirmVehicle)}
              />
              <BigButton
                label={`Non, garder ${application.vehicle ? VEHICLE_LABELS[application.vehicle] : 'mon véhicule'}`}
                variant="ghost"
                onPress={() => setConfirmVehicle(null)}
              />
            </View>
          ) : null}
          <Text style={styles.note}>
            À vélo ou à pied : ni permis ni papiers du véhicule (leurs photos sont alors
            supprimées).
          </Text>
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
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          aria-live="polite"
          style={styles.error}
        >
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
        <BigButton
          label="En ligne"
          variant="secondary"
          disabled
          onPress={() => undefined}
          hint="Impossible tant que DJAFAT ne vous a pas validé."
          describedBy="online-why"
        />
        <Text nativeID="online-why" style={styles.note}>
          Impossible tant que DJAFAT ne vous a pas validé.
        </Text>
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
      // `aria-checked`: what a radio says on a phone and in a browser (aria-selected is not a radio's state).
      aria-checked={selected}
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
  // SPEC-024-02 R1, R4: a stored Chad number comes back as its 8 digits, behind « +235 ».
  const [number, setNumber] = useState(phoneForField(application.mobileMoney?.number));
  const [name, setName] = useState(application.emergencyContact?.name ?? '');
  const [phone, setPhone] = useState(phoneForField(application.emergencyContact?.phone));
  /** FEAT-024: a field refused before sending — said right under that field, in the server's words. */
  const [invalid, setInvalid] = useState<{
    field: 'number' | 'name' | 'phone';
    message: string;
  } | null>(null);
  const messageFor = (field: 'number' | 'name' | 'phone') =>
    invalid?.field === field ? invalid.message : null;
  const nameMessage = messageFor('name');

  if (item === 'mobile_money') {
    return (
      <View style={styles.panel}>
        <View
          style={styles.choices}
          accessibilityRole="radiogroup"
          accessibilityLabel="Opérateur Mobile Money"
        >
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
        {/* FEAT-024 (SPEC-024-02 R4): a Chad mobile only — « +235 » always shows. */}
        <PhoneInput
          label="Numéro Mobile Money"
          use="mobile_money"
          inputStyle={styles.input}
          error={messageFor('number')}
          value={number}
          onChangeText={(text) => {
            setNumber(text);
            setInvalid(null);
          }}
          placeholder="66 12 34 56"
        />
        <BigButton
          label="Enregistrer"
          loading={busy}
          onPress={() => {
            const why = phoneFieldError(number, 'mobile_money', 'Indiquez le numéro Mobile Money.');
            if (why) {
              setInvalid({ field: 'number', message: why });
              return;
            }
            onSave({ mobileMoney: { provider, number } });
          }}
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
          onChangeText={(text) => {
            setName(text);
            setInvalid(null);
          }}
          autoCapitalize="words"
          aria-invalid={nameMessage ? true : undefined}
        />
        {nameMessage ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            aria-live="polite"
            style={styles.error}
          >
            {nameMessage}
          </Text>
        ) : null}
        <Text style={styles.label}>Son téléphone</Text>
        {/* FEAT-024 (SPEC-024-02 R3): a number to call — foreign or fixed allowed. */}
        <PhoneInput
          label="Téléphone de la personne à prévenir"
          use="contact"
          inputStyle={styles.input}
          error={messageFor('phone')}
          value={phone}
          onChangeText={(text) => {
            setPhone(text);
            setInvalid(null);
          }}
          placeholder="99 12 34 56"
        />
        <BigButton
          label="Enregistrer"
          loading={busy}
          onPress={() => {
            // SPEC-024-03 R3: a person's name, letters only — each message under its own field.
            const nameWhy = personNameError(name, 'Écrivez le nom de la personne à prévenir.');
            if (nameWhy) {
              setInvalid({ field: 'name', message: nameWhy });
              return;
            }
            const phoneWhy = phoneFieldError(phone, 'contact', 'Indiquez son téléphone.');
            if (phoneWhy) {
              setInvalid({ field: 'phone', message: phoneWhy });
              return;
            }
            onSave({ emergencyContact: { name, phone } });
          }}
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
  confirm: {
    gap: tokens.space['2'],
    padding: tokens.space['3'],
    borderRadius: tokens.radius.md,
    backgroundColor: tokens.color.state.dangerBg,
  },
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
