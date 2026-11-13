'use client';

import { useEffect, useRef, useState } from 'react';
import type { VoiceNote } from '@djafat/sdk';
import { Text } from '@djafat/ui';
import { Alert, Button } from '@/components/ui-client';

/** FEAT-018 (SPEC-018-03) — what the server accepts. */
export const VOICE_NOTE_MAX_MS = 10_000;
export const VOICE_NOTE_MAX_BYTES = 40 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

function pickMime(): VoiceNote['mime'] {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm';
  for (const m of ['audio/webm', 'audio/ogg', 'audio/mp4'] as const) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'audio/webm';
}

/**
 * Records a ≤ 10 s voice note for the courier (« le portail bleu après la
 * boutique »). Stops by itself at 10 s; refuses anything over 40 KB. The
 * parent decides when to upload (`onRecorded`) or delete (`onRemove`).
 */
export function VoiceNoteRecorder({
  hasSaved,
  pending,
  onRecorded,
  onRemove,
  onPlaySaved,
}: {
  hasSaved: boolean;
  pending: VoiceNote | null;
  onRecorded: (note: VoiceNote | null) => void;
  onRemove?: () => void;
  onPlaySaved?: () => void;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  async function start() {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Votre navigateur ne permet pas d’enregistrer le son.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = pickMime();
      const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const durationMs = Math.min(
          VOICE_NOTE_MAX_MS,
          Math.max(1, Math.round(Date.now() - startedAt.current)),
        );
        const blob = new Blob(chunks, { type: mime });
        if (blob.size > VOICE_NOTE_MAX_BYTES) {
          setError('Note trop lourde (plus de 40 Ko) : refaites-la plus courte.');
          onRecorded(null);
          return;
        }
        void blob
          .arrayBuffer()
          .then((buf) => onRecorded({ mime, dataBase64: toBase64(buf), durationMs }));
      };
      recorder.current = rec;
      startedAt.current = Date.now();
      rec.start();
      setRecording(true);
      timer.current = setTimeout(() => stop(), VOICE_NOTE_MAX_MS);
    } catch {
      setError('Micro refusé ou indisponible.');
    }
  }

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }

  function playPending() {
    if (!pending) return;
    void new Audio(`data:${pending.mime};base64,${pending.dataBase64}`).play();
  }

  return (
    <div role="group" aria-label="Note vocale pour le livreur">
      <Text weight="bold">Note vocale pour le livreur</Text>
      <Text size="small" tone="secondary">
        10 secondes maximum, par exemple : « portail bleu, juste après la boutique ».
      </Text>
      {error && <Alert tone="danger">{error}</Alert>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {recording ? (
          <Button type="button" variant="secondary" onClick={stop} aria-live="polite">
            ⏹ Arrêter l’enregistrement
          </Button>
        ) : (
          <Button type="button" variant="secondary" onClick={() => void start()}>
            🎙 Enregistrer une note pour le livreur (10 s max)
          </Button>
        )}
        {pending && (
          <>
            <Button type="button" variant="ghost" onClick={playPending}>
              ▶ Écouter ({Math.round(pending.durationMs / 1000)} s)
            </Button>
            <Button type="button" variant="ghost" onClick={() => onRecorded(null)}>
              Effacer
            </Button>
          </>
        )}
        {!pending && hasSaved && (
          <>
            {onPlaySaved && (
              <Button type="button" variant="ghost" onClick={onPlaySaved}>
                ▶ Écouter la note enregistrée
              </Button>
            )}
            {onRemove && (
              <Button type="button" variant="ghost" onClick={onRemove}>
                Supprimer la note
              </Button>
            )}
          </>
        )}
      </div>
      {pending && (
        <Text size="small" tone="secondary">
          Nouvelle note prête : elle sera envoyée en enregistrant l’adresse.
        </Text>
      )}
    </div>
  );
}
