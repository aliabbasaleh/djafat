'use client';

import { useEffect, useRef } from 'react';
import { ACCOUNT_TYPES, type AccountType } from '@/lib/account';
import styles from './account.module.css';

/**
 * Step 1 of « Créer un compte » (FEAT-022-VIS01, SPEC-022-01 R1): three
 * buttons, Client, Livreur, Restaurant. Back from a form (« ← Changer de
 * type »), the question takes the focus again.
 */
export function AccountTypeChoice({
  onChoose,
  focusTitle,
}: {
  readonly onChoose: (type: AccountType) => void;
  readonly focusTitle: boolean;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusTitle) title.current?.focus();
  }, [focusTitle]);

  return (
    <div className={styles['panel']}>
      <h2 ref={title} tabIndex={-1} className={styles['stepTitle']}>
        Quel compte voulez-vous créer ?
      </h2>
      <div className={styles['typeList']}>
        {ACCOUNT_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            className={styles['typeCard']}
            onClick={() => onChoose(type.id)}
          >
            <span className={styles['typeIcon']} aria-hidden="true">
              {type.icon}
            </span>
            <span className={styles['typeText']}>
              <span className={styles['typeTitle']}>{type.title}</span>
              <span className={styles['typeDescription']}>{type.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
