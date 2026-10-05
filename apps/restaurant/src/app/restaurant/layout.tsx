'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Header, Container, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { getStoredUser, hasRestaurantAccess, clearSession } from '@/lib/auth-storage';
import styles from './layout.module.css';

const NAV_ITEMS = [
  { label: 'Commandes', href: '/restaurant' },
  { label: 'Historique', href: '/restaurant/history' },
  { label: 'Menu', href: '/restaurant/menu' },
  { label: 'Horaires', href: '/restaurant/hours' },
  { label: 'Relevé', href: '/restaurant/wallet' },
  { label: 'Profil', href: '/restaurant/profile' },
  { label: 'Support', href: '/restaurant/support' },
];

/**
 * The auth gate + nav for every `/restaurant/**` page (Bloc 10, docs/33) —
 * scoped to THIS segment only, so `/login` never sees it (no redirect loop).
 * Client-side only: the session lives in `localStorage`, unreadable during
 * server rendering — same constraint `apps/admin`/`apps/web` already
 * documented for their own gated segments.
 */
export default function RestaurantLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    if (!hasRestaurantAccess(user)) {
      router.replace('/login');
      return;
    }
    setChecked(true);
  }, [router, pathname]);

  function logout() {
    clearSession();
    router.push('/login');
  }

  if (!checked) return null; // avoids a flash of protected chrome before the redirect fires

  return (
    <>
      <Header
        wordmark="DJAFAT Restaurant"
        logoHref="/restaurant"
        navItems={NAV_ITEMS}
        actions={
          <Button variant="ghost" size="sm" onClick={logout}>
            Déconnexion
          </Button>
        }
      />
      <Container as="main" className={cx(styles['main'])}>
        {children}
      </Container>
    </>
  );
}
