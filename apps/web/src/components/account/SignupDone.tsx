'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Text } from '@djafat/ui';
import { appUrl } from '@/lib/api';
import { signupDoneText } from '@/lib/account';
import styles from './account.module.css';

/**
 * After the right code, for a courier or a restaurant (SPEC-022-02 R6,
 * SPEC-022-03 R4, FEAT-022-VIS02, VIS03): what to complete, and where. The
 * session is already open on the site; the welcome e-mail says it again.
 */
export function SignupDone({
  type,
  restaurantName,
}: {
  readonly type: 'courier' | 'restaurant';
  readonly restaurantName: string;
}) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);
  const done = signupDoneText(type, restaurantName);
  const target = appUrl(type === 'courier' ? 'courier' : 'restaurant');

  return (
    <div className={styles['panel']}>
      <h2 ref={title} tabIndex={-1} className={styles['stepTitle']}>
        {done.title}
      </h2>
      <Text>{done.text}</Text>
      <Text tone="secondary">Un e-mail « Bienvenue sur DJAFAT » vous rappelle ces étapes.</Text>
      {target && (
        <a className={styles['primaryLink']} href={target}>
          {done.action}
        </a>
      )}
      <Link className={styles['linkButton']} href="/">
        Aller à l’accueil
      </Link>
    </div>
  );
}
