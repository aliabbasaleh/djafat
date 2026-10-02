'use client';

import { useEffect, useState } from 'react';
import { Heading, Text, Stack, Grid, cx } from '@djafat/ui';
import { Button } from '@/components/ui-client';
import { getStoredUser, type StoredAdminUser } from '@/lib/auth-storage';
import styles from './page.module.css';

const SECTIONS = [
  { label: 'Utilisateurs', href: '/admin/users', description: 'Rôles, suspension, recherche.' },
  { label: 'Restaurants', href: '/admin/restaurants', description: 'Statuts et soldes.' },
  { label: 'Livreurs', href: '/admin/couriers', description: 'Statuts, suspension, soldes.' },
  { label: 'Commandes', href: '/admin/orders', description: 'Recherche opérationnelle.' },
  {
    label: 'Finance',
    href: '/admin/finance',
    description: 'Soldes et règlements (lecture seule).',
  },
];

export default function AdminDashboardPage() {
  const [user, setUser] = useState<StoredAdminUser | null>(null);

  useEffect(() => {
    setUser(getStoredUser());
  }, []);

  return (
    <Stack gap="lg">
      <Stack gap="xs">
        <Heading level={1}>Tableau de bord</Heading>
        <Text tone="secondary">
          {user ? `Connecté en tant que ${user.fullName ?? user.phone}.` : ' '}
        </Text>
      </Stack>
      <Grid minItemWidth={220} gap="md">
        {SECTIONS.map((s) => (
          <div key={s.href} className={cx(styles['card'])}>
            <Stack gap="xs">
              <Text weight="bold">{s.label}</Text>
              <Text size="small" tone="secondary">
                {s.description}
              </Text>
              <Button href={s.href} variant="secondary" size="sm">
                Ouvrir
              </Button>
            </Stack>
          </div>
        ))}
      </Grid>
    </Stack>
  );
}
