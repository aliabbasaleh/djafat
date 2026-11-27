import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from '@djafat/tokens';
import type { CourierDocumentKind } from '@djafat/core';
import { ApiClientError, pendingChangeOf, type CourierApplication } from '@djafat/sdk';
import { Screen } from '../../components/Screen';
import { BigButton } from '../../components/BigButton';
import { PhotoSourceSheet } from '../../components/PhotoSourceSheet';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth-context';
import { PHOTO_LABELS, applicationErrorMessage } from '../../lib/application';

/**
 * FEAT-022 (SPEC-022-07 R6): « Mes papiers » — a validated courier replaces a
 * paper (a renewed licence, a new insurance…). The new photo waits for
 * DJAFAT; the approved one stays valid meanwhile, and the courier keeps
 * working. Before the validation, the papers are filled in « Avant votre
 * première course » instead.
 */
export default function PapersScreen() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [application, setApplication] = useState<CourierApplication | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'none' | 'error'>('loading');
  const [sheetFor, setSheetFor] = useState<CourierDocumentKind | null>(null);
  const [busy, setBusy] = useState<CourierDocumentKind | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const mine = await api.courier.application.get();
      if (mine.status !== 'approved') {
        router.replace('/(app)/onboarding');
        return;
      }
      setApplication(mine);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        await signOut();
        return;
      }
      setState(
        err instanceof ApiClientError && err.code === 'APPLICATION_NOT_FOUND' ? 'none' : 'error',
      );
    }
  }, [router, signOut]);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(kind: CourierDocumentKind, photo: Blob) {
    setBusy(kind);
    setMessage(null);
    try {
      setApplication(await api.courier.application.uploadPhoto(kind, photo));
      setMessage(
        `${PHOTO_LABELS[kind]} envoyée : DJAFAT la vérifie. Votre papier actuel reste valable jusque-là.`,
      );
    } catch (err) {
      setMessage(applicationErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          Mes papiers
        </Text>
        <BigButton label="Retour" variant="ghost" onPress={() => router.back()} />
      </View>

      {state === 'loading' && <Text style={styles.subtle}>Chargement…</Text>}
      {state === 'error' && (
        <>
          <Text style={styles.subtle}>Connexion au serveur impossible.</Text>
          <BigButton label="Réessayer" onPress={() => void load()} />
        </>
      )}
      {state === 'none' && (
        <Text style={styles.subtle}>Vos papiers sont gérés par DJAFAT : contactez-nous.</Text>
      )}

      {state === 'ready' && application && (
        <>
          <Text style={styles.subtle}>
            Un nouveau papier attend l’accord de DJAFAT ; l’ancien reste valable jusque-là, et vous
            continuez à travailler.
          </Text>
          {message && (
            <Text style={styles.message} accessibilityLiveRegion="polite" aria-live="polite">
              {message}
            </Text>
          )}
          {application.photos.map((p) => {
            const waiting = pendingChangeOf(application, p.kind);
            const state = waiting
              ? 'Nouvelle photo en attente de DJAFAT'
              : p.uploaded
                ? 'Validée'
                : 'Pas de photo';
            return (
              <View key={p.kind} style={styles.card}>
                <Text style={styles.rowTitle}>{PHOTO_LABELS[p.kind]}</Text>
                <Text style={styles.subtle}>
                  {waiting ? '⏳' : p.uploaded ? '✅' : '⬜'} {state}
                </Text>
                <BigButton
                  label={`Remplacer : ${PHOTO_LABELS[p.kind]}`}
                  variant="secondary"
                  loading={busy === p.kind}
                  onPress={() => setSheetFor(p.kind)}
                />
              </View>
            );
          })}
        </>
      )}

      <PhotoSourceSheet
        kind={sheetFor}
        onClose={() => setSheetFor(null)}
        onError={setMessage}
        onPicked={(kind, photo) => void send(kind, photo)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.space['4'],
  },
  title: { fontSize: tokens.type.size.h1, fontWeight: '700', color: tokens.color.text.primary },
  subtle: { fontSize: tokens.type.size.body, color: tokens.color.text.secondary },
  message: {
    fontSize: tokens.type.size.body,
    color: tokens.color.text.primary,
    marginVertical: tokens.space['2'],
  },
  card: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radius.lg,
    padding: tokens.space['4'],
    marginTop: tokens.space['3'],
    gap: tokens.space['2'],
  },
  rowTitle: {
    fontSize: tokens.type.size.body,
    fontWeight: '700',
    color: tokens.color.text.primary,
  },
});
