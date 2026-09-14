import type { RestaurantAvailabilityStatus } from '@djafat/types';
import { Badge, type BadgeTone } from '../feedback/Badge.js';

/**
 * Renders the SERVER-computed availability status — the status itself always
 * comes from `RestaurantAvailabilityService` (apps/api). This component only
 * turns it into words/colour; it never recomputes open/closed from hours
 * (docs/20 §22-§23, carried into docs/21).
 */
const LABEL: Record<RestaurantAvailabilityStatus, string> = {
  OPEN: 'Ouvert',
  CLOSED: 'Fermé',
  PAUSED: 'Fermé temporairement',
  UNAVAILABLE: 'Indisponible',
};

const TONE: Record<RestaurantAvailabilityStatus, BadgeTone> = {
  OPEN: 'success',
  CLOSED: 'neutral',
  PAUSED: 'warning',
  UNAVAILABLE: 'neutral',
};

export function RestaurantStatusBadge({
  status,
  className,
}: {
  status: RestaurantAvailabilityStatus;
  className?: string;
}) {
  return (
    <Badge tone={TONE[status]} {...(className !== undefined ? { className } : {})}>
      {LABEL[status]}
    </Badge>
  );
}
