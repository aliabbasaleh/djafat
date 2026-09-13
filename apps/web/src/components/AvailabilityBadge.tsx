import type { RestaurantAvailabilityStatus } from '@djafat/sdk';
import { AVAILABILITY_LABEL, AVAILABILITY_TONE } from '@/lib/availability';
import styles from './AvailabilityBadge.module.css';

/**
 * Renders the server-computed availability status (docs/20 §22-§23). Colour
 * is never the only signal — the text label always carries the meaning too
 * (WCAG 2.2 — no colour-only signalling, docs/20 §44).
 */
export function AvailabilityBadge({ status }: { status: RestaurantAvailabilityStatus }) {
  const tone = AVAILABILITY_TONE[status];
  return <span className={`${styles['badge']} ${styles[tone]}`}>{AVAILABILITY_LABEL[status]}</span>;
}
