'use client';

import { useEffect, useState } from 'react';
import type { Route } from 'next';
import { useRouter, usePathname } from 'next/navigation';
import { Header, Container, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { StepUpProvider } from '@/components/StepUp';
import { getStoredUser, hasAdminAccess, isFinance, isFullAdmin } from '@/lib/auth-storage';
import { signOut } from '@/lib/session';
import styles from './layout.module.css';

type Access = 'support' | 'finance';

/** Full admins see every page; support and finance only the pages listed for them. */
const NAV_ITEMS: ReadonlyArray<{ label: string; href: string; access?: readonly Access[] }> = [
  { label: 'Commande par téléphone', href: '/admin/phone-order', access: ['support'] },
  { label: 'Tableau de bord', href: '/admin' },
  { label: 'Utilisateurs', href: '/admin/users' },
  { label: 'Restaurants', href: '/admin/restaurants' },
  { label: 'Livreurs', href: '/admin/couriers' },
  { label: 'Commandes', href: '/admin/orders', access: ['support'] },
  { label: 'Finance', href: '/admin/finance', access: ['finance'] },
  { label: 'Remboursements', href: '/admin/refunds', access: ['finance'] },
  { label: 'Versements livreurs', href: '/admin/payouts' },
  { label: 'Sécurité', href: '/admin/security', access: ['finance'] },
];

/**
 * The auth gate + nav for every `/admin/**` page (Bloc 9, docs/30
 * §admin-web) — scoped to THIS segment only, so `/login` never sees it (no
 * redirect loop). Client-side only: the session lives in `localStorage`,
 * unreadable during server rendering, same constraint `apps/web` already
 * documented for its own cart/order pages.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [allowed, setAllowed] = useState<typeof NAV_ITEMS>([]);

  useEffect(() => {
    const user = getStoredUser();
    if (!hasAdminAccess(user)) {
      router.replace(`/login`);
      return;
    }
    const roles: Access[] = [
      ...(user?.roles.includes('support') ? (['support'] as const) : []),
      ...(isFinance(user) ? (['finance'] as const) : []),
    ];
    const items = isFullAdmin(user)
      ? NAV_ITEMS
      : NAV_ITEMS.filter((i) => i.access?.some((a) => roles.includes(a)));
    setAllowed(items);
    // Support lands on the phone order screen, finance on the finance page:
    // the first page of their job.
    if (!items.some((i) => i.href === pathname)) {
      router.replace((items[0]?.href ?? '/login') as Route);
    }
    setChecked(true);
  }, [router, pathname]);

  function logout() {
    // FEAT-004: revoke server-side, then clear locally, then leave.
    void signOut().then(() => router.push('/login'));
  }

  if (!checked) return null; // avoids a flash of protected chrome before the redirect fires

  return (
    <>
      <Header
        wordmark="DJAFAT Admin"
        logoHref="/admin"
        navItems={allowed.map(({ label, href }) => ({ label, href }))}
        actions={
          <Button variant="ghost" size="sm" onClick={logout}>
            Déconnexion
          </Button>
        }
      />
      <Container as="main" className={cx(styles['main'])}>
        <StepUpProvider>{children}</StepUpProvider>
      </Container>
    </>
  );
}
