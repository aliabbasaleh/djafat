'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Header, Container, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { getStoredUser, hasAdminAccess, clearSession } from '@/lib/auth-storage';
import styles from './layout.module.css';

const NAV_ITEMS = [
  { label: 'Tableau de bord', href: '/admin' },
  { label: 'Utilisateurs', href: '/admin/users' },
  { label: 'Restaurants', href: '/admin/restaurants' },
  { label: 'Livreurs', href: '/admin/couriers' },
  { label: 'Commandes', href: '/admin/orders' },
  { label: 'Finance', href: '/admin/finance' },
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

  useEffect(() => {
    const user = getStoredUser();
    if (!hasAdminAccess(user)) {
      router.replace(`/login`);
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
        wordmark="DJAFAT Admin"
        logoHref="/admin"
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
