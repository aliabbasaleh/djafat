'use client';

import { Suspense, useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SignedIn } from '@djafat/sdk';
import { Container, Heading, Stack, cx } from '@djafat/ui';
import { Tabs } from '@/components/ui-client';
import { LoginPanel, type AuthMethods } from '@/components/account/LoginPanel';
import { RegisterPanel } from '@/components/account/RegisterPanel';
import { api } from '@/lib/api';
import { isAuthenticated, setDeviceToken, setSession } from '@/lib/auth-storage';
import { safeRedirect } from '@/lib/account';
import styles from './page.module.css';

type TabId = 'connexion' | 'inscription';

/**
 * « Mon compte » (FEAT-020, SPEC-020-07, SPEC-020-10): the header's « Compte »
 * leads here. Two tabs — « Se connecter » (default) and « Créer un compte »
 * (`?onglet=inscription`). After logging in, back to `redirect` (internal
 * paths only) or the home page.
 */
export default function ComptePage() {
  return (
    <Suspense fallback={null}>
      <Compte />
    </Suspense>
  );
}

function Compte() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = safeRedirect(params.get('redirect'));
  const [tab, setTab] = useState<TabId>(
    params.get('onglet') === 'inscription' ? 'inscription' : 'connexion',
  );
  // undefined while loading, null when the call failed (only the e-mail is offered then).
  const [methods, setMethods] = useState<AuthMethods | undefined>(undefined);

  useEffect(() => {
    if (isAuthenticated()) router.replace(redirectTo as Route);
  }, [router, redirectTo]);

  useEffect(() => {
    api.auth
      .methods()
      .then((res) => setMethods(res.methods))
      .catch(() => setMethods(null));
  }, []);

  function onSignedIn(result: SignedIn) {
    setSession({
      access: result.access,
      refresh: result.refresh,
      user: {
        id: result.user.id,
        phone: result.user.phone,
        fullName: result.user.fullName,
        roles: result.user.roles,
      },
    });
    if (result.deviceToken) setDeviceToken(result.deviceToken);
    router.push(redirectTo as Route);
  }

  return (
    <Container as="main" maxWidth={420} className={cx(styles['main'])}>
      <Stack gap="lg">
        <Heading level={1}>Mon compte</Heading>
        <Tabs
          aria-label="Mon compte"
          items={[
            { id: 'connexion', label: 'Se connecter' },
            { id: 'inscription', label: 'Créer un compte' },
          ]}
          activeId={tab}
          onChange={(id) => setTab(id === 'inscription' ? 'inscription' : 'connexion')}
        />
        <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === 'connexion' ? (
            <LoginPanel methods={methods ?? null} onSignedIn={onSignedIn} />
          ) : (
            <RegisterPanel onSignedIn={onSignedIn} onGoToLogin={() => setTab('connexion')} />
          )}
        </div>
      </Stack>
    </Container>
  );
}
