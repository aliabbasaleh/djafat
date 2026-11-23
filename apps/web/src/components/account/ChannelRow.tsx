'use client';

import type { CodeChannelId } from '@djafat/sdk';
import { cx } from '@djafat/ui';
import type { ChannelButton } from '@/lib/account';
import { ChannelIcon } from './ChannelIcons';
import styles from './account.module.css';

interface ChannelRowProps {
  readonly buttons: readonly ChannelButton[];
  readonly label: string;
  readonly selected?: CodeChannelId | undefined;
  readonly onSelect: (button: ChannelButton) => void;
}

/**
 * E-mail, WhatsApp, SMS (FEAT-020-VIS01). A channel the server does not offer
 * yet is disabled and says « Bientôt disponible » in words, not only in grey.
 */
export function ChannelRow({ buttons, label, selected, onSelect }: ChannelRowProps) {
  return (
    <div className={styles['channels']} role="group" aria-label={label}>
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          className={cx(styles['channel'], selected === b.id && styles['channelSelected'])}
          disabled={!b.enabled}
          aria-pressed={selected === undefined ? undefined : selected === b.id}
          onClick={() => onSelect(b)}
        >
          <span className={styles['channelName']}>
            <ChannelIcon id={b.id} /> {b.label}
          </span>
          {b.note && <span className={styles['channelNote']}>{b.note}</span>}
        </button>
      ))}
    </div>
  );
}
