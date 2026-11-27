'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, type RestaurantApplication } from '@djafat/sdk';
import { api } from './api';

/**
 * FEAT-022 (SPEC-022-05): the restaurant's application, for the pages of the
 * four steps. `undefined` while loading; `null` when there is none — a
 * restaurant created by the team (404) or a staff account, which never sees
 * the papers (403) — and the console then works as before FEAT-022.
 */
export function useRestaurantApplication() {
  const [application, setApplication] = useState<RestaurantApplication | null | undefined>(
    undefined,
  );
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    setFailed(false);
    try {
      setApplication(await api.restaurant.application.get());
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 404 || err.status === 403)) {
        setApplication(null);
        return;
      }
      setFailed(true);
      setApplication(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { application, setApplication, reload, failed };
}

/** R5: while DJAFAT checks the application, the steps are readable but do not change. */
export function underReview(application: RestaurantApplication | null | undefined): boolean {
  return application?.status === 'pending_review';
}

export const UNDER_REVIEW_TEXT =
  'Votre dossier est en vérification par DJAFAT : cette étape se lit, mais ne se modifie plus pour le moment.';

/** The message of a refused request: the API's own when it gave one. */
export function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiClientError && err.message ? err.message : fallback;
}
