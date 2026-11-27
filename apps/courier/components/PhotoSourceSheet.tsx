import * as ImagePicker from 'expo-image-picker';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import type { CourierDocumentKind } from '@djafat/core';
import { PHOTO_LABELS, pickedPhoto } from '../lib/application';
import { BigButton } from './BigButton';

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
 * FEAT-022 (SPEC-022-06 R2, FEAT-022-Q10): « Prendre une photo » or « Choisir
 * dans la galerie » for one paper — the sheet of « Avant votre première
 * course » and of « Mes papiers ». The photo comes back as the bytes to send.
 */
export function PhotoSourceSheet({
  kind,
  onClose,
  onPicked,
  onError,
}: {
  /** The paper the sheet is for; `null` closes it. */
  readonly kind: CourierDocumentKind | null;
  readonly onClose: () => void;
  readonly onPicked: (kind: CourierDocumentKind, photo: Blob) => void;
  readonly onError: (message: string) => void;
}) {
  async function pick(source: 'camera' | 'library') {
    if (!kind) return;
    const forKind = kind;
    onClose();
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        onError(
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
    try {
      onPicked(forKind, await pickedPhoto(asset.uri));
    } catch {
      // Review of FEAT-022 part 3, #6: never a silent failure.
      onError('Cette photo n’a pas pu être lue : reprenez-la, ou choisissez-en une autre.');
    }
  }

  return (
    <Modal visible={kind !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text accessibilityRole="header" style={styles.title}>
            {kind ? PHOTO_LABELS[kind] : ''}
          </Text>
          <BigButton label="Prendre une photo" onPress={() => void pick('camera')} />
          <BigButton
            label="Choisir dans la galerie"
            variant="secondary"
            onPress={() => void pick('library')}
          />
          <BigButton label="Annuler" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    gap: tokens.space['3'],
    padding: tokens.space['4'],
    paddingBottom: tokens.space['6'],
    borderTopLeftRadius: tokens.radius.lg,
    borderTopRightRadius: tokens.radius.lg,
    backgroundColor: tokens.color.bg.canvas,
  },
  title: {
    fontSize: tokens.type.size.h2,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
});
