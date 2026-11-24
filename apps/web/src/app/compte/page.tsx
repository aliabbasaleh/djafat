'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
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
 * (`?onglet=inscription`, or `?inscription=livreur | restaurant` straight to
 * that form, FEAT-022). After logging in, back to `redirect` (internal paths
 * only) or the home page.
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
  // FEAT-022 (SPEC-022-01 R4): `?inscription=livreur | restaurant` opens « Créer un compte » on that form.
  const signupType = params.get('inscription');
  const [tab, setTab] = useState<TabId>(
    params.get('onglet') === 'inscription' || signupType ? 'inscription' : 'connexion',
  );
  // undefined while loading, null when the call failed (only the e-mail is offered then).
  const [methods, setMethods] = useState<AuthMethods | undefined>(undefined);

  // Only on arrival: a sign-up that just opened a session stays on its « what next » screen.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if (!isAuthenticated()) return;
    // SPEC-022-08: signed in already, « Devenir livreur » adds the role in « Mon profil ».
    const role = signupType === 'livreur' || signupType === 'restaurant' ? signupType : null;
    router.replace((role ? `/profil?devenir=${role}` : redirectTo) as Route);
  }, [router, redirectTo, signupType]);

  useEffect(() => {
    api.auth
      .methods()
      .then((res) => setMethods(res.methods))
      .catch(() => setMethods(null));
  }, []);

  /** The session of a new courier or restaurant: kept, the « what next » screen stays (SPEC-022-02 R6). */
  function keepSession(result: SignedIn) {
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
  }

  function onSignedIn(result: SignedIn) {
    keepSession(result);
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
            <RegisterPanel
              onSignedIn={onSignedIn}
              onSignedUp={keepSession}
              onGoToLogin={() => setTab('connexion')}
              initialType={signupType}
            />
          )}
        </div>
      </Stack>
    </Container>
  );
}
