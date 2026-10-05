'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError } from '@djafat/sdk';
import { Heading, Text, Stack, Inline, EmptyState, ErrorState, Skeleton, cx } from '@djafat/ui';
import { Button, Alert, Switch } from '@/components/ui-client';
import { api } from '@/lib/api';
import { clearSession, getStoredUser, isOwner } from '@/lib/auth-storage';
import { weekdayLabel, minutesToTimeInput, timeInputToMinutes } from '@/lib/format';
import styles from './page.module.css';

type LoadState = 'loading' | 'ready' | 'error';

interface DayRow {
  open: boolean;
  opensMinutes: number;
  closesMinutes: number;
}

const DEFAULT_ROW: DayRow = { open: false, opensMinutes: 8 * 60, closesMinutes: 22 * 60 };

function emptyWeek(): DayRow[] {
  return Array.from({ length: 7 }, () => ({ ...DEFAULT_ROW }));
}

/**
 * Weekly opening hours (Bloc 10, docs/33 §hours) — ONE window per weekday in
 * this UI (open/close toggle + two time pickers). The API model supports
 * several windows per day (e.g. lunch + dinner — `RestaurantHours` has no
 * uniqueness constraint on `weekday`), but a split-hours EDITOR is a
 * genuinely separate feature or two, not a corner of this one; a single
 * window per day covers the common case and is listed as remaining debt in
 * docs/33, not silently limited without saying so.
 *
 * `cityTimezone` is shown, never edited — "the city's timezone is the
 * authority for hours" was decided at Bloc 0 (docs/19) and stays a platform
 * setting, not a per-restaurant one.
 */
export default function HoursPage() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [timezone, setTimezone] = useState('');
  const [week, setWeek] = useState<DayRow[]>(emptyWeek());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const canWrite = isOwner(getStoredUser());

  const load = useCallback(async () => {
    setState('loading');
    try {
      const profile = await api.restaurant.getMine();
      setTimezone(profile.cityTimezone);
      const next = emptyWeek();
      for (const h of profile.hours) {
        if (h.weekday >= 0 && h.weekday < 7) {
          next[h.weekday] = {
            open: true,
            opensMinutes: h.opensMinutes,
            closesMinutes: h.closesMinutes,
          };
        }
      }
      setWeek(next);
      setState('ready');
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        clearSession();
        router.replace('/login');
        return;
      }
      setState('error');
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateDay(index: number, patch: Partial<DayRow>) {
    setWeek((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function save() {
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const hours = week
        .map((row, weekday) => ({ weekday, ...row }))
        .filter((row) => row.open)
        .map(({ weekday, opensMinutes, closesMinutes }) => ({
          weekday,
          opensMinutes,
          closesMinutes,
        }));
      await api.restaurant.replaceHours(hours);
      setSuccess('Horaires mis à jour.');
    } catch {
      setError('Échec de la mise à jour des horaires.');
    } finally {
      setSaving(false);
    }
  }

  if (state === 'loading') {
    return (
      <Stack gap="sm" aria-busy="true" aria-label="Chargement des horaires">
        <Skeleton height={40} />
        <Skeleton height={320} radius="8px" />
      </Stack>
    );
  }
  if (state === 'error') {
    return (
      <ErrorState
        title="Impossible de charger les horaires"
        action={<Button onClick={() => void load()}>Réessayer</Button>}
      />
    );
  }

  return (
    <Stack gap="lg">
      <Heading level={1}>Horaires</Heading>
      <Text size="small" tone="secondary">
        Fuseau horaire de la ville : {timezone}
      </Text>

      {!canWrite && (
        <Alert tone="info">
          Seul le propriétaire du restaurant peut modifier les horaires. Vous pouvez les consulter.
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      {success && <Alert tone="success">{success}</Alert>}

      <Stack gap="sm">
        {week.map((row, i) => (
          <Inline key={i} align="center" gap="md" className={cx(styles['row'])}>
            <Text className={cx(styles['dayLabel'])} weight="medium">
              {weekdayLabel(i)}
            </Text>
            <Switch
              label={row.open ? 'Ouvert' : 'Fermé'}
              checked={row.open}
              disabled={!canWrite}
              onChange={(e) => updateDay(i, { open: e.target.checked })}
            />
            {row.open && (
              <Inline gap="sm" align="center">
                <input
                  type="time"
                  className={cx(styles['timeInput'])}
                  value={minutesToTimeInput(row.opensMinutes)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    updateDay(i, { opensMinutes: timeInputToMinutes(e.target.value) })
                  }
                />
                <Text size="small" tone="muted">
                  à
                </Text>
                <input
                  type="time"
                  className={cx(styles['timeInput'])}
                  value={minutesToTimeInput(row.closesMinutes)}
                  disabled={!canWrite}
                  onChange={(e) =>
                    updateDay(i, { closesMinutes: timeInputToMinutes(e.target.value) })
                  }
                />
              </Inline>
            )}
          </Inline>
        ))}
      </Stack>

      {canWrite && (
        <div>
          <Button loading={saving} onClick={() => void save()}>
            Enregistrer les horaires
          </Button>
        </div>
      )}

      {week.every((row) => !row.open) && (
        <EmptyState
          icon="🕒"
          title="Aucun horaire défini"
          message="Le restaurant apparaîtra comme fermé tant qu’aucun jour n’est activé."
        />
      )}
    </Stack>
  );
}
