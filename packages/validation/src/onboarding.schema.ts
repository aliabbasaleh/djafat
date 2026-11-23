import { z } from 'zod';
import { tidyPlaceName } from '@djafat/core';

/**
 * FEAT-022 (SPEC-022-09 R3, R4): a neighbourhood name, typed by an admin or by a
 * courier / restaurant under « Autre » — trimmed, inner spaces collapsed, 2 to
 * 60 characters. Shared by the API and the clients' forms.
 */
export const NeighbourhoodNameSchema = z
  .string()
  .transform(tidyPlaceName)
  .pipe(z.string().min(2, 'Au moins 2 caractères.').max(60, 'Au plus 60 caractères.'));

/** A city slug (`ndjamena`), as the neighbourhood list is asked for. */
export const CitySlugSchema = z.string().regex(/^[a-z0-9-]{2,40}$/, 'Ville invalide.');
