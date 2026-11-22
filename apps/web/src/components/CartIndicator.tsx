'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { isAuthenticated, getStoredUser } from '@/lib/auth-storage';
import styles from './CartIndicator.module.css';

/**
 * Header cart badge + auth control (docs/22 §17.4). Refetches the item
 * count whenever auth state changes or another component dispatches
 * `djafat:cart-changed` (ProductOptionsForm on add, /panier on mutate) —
 * no polling, no global cart store; the header is just another cart reader.
 */
export function CartIndicator() {
  const [authed, setAuthed] = useState(false);
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    const loggedIn = isAuthenticated();
    setAuthed(loggedIn);
    if (!loggedIn) {
      setCount(0);
      return;
    }
    try {
      const { cart } = await api.cart.getCart();
      const total = cart ? cart.items.reduce((sum, item) => sum + item.quantity, 0) : 0;
      setCount(total);
    } catch {
      setCount(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('djafat:auth-changed', onChange);
    window.addEventListener('djafat:cart-changed', onChange);
    return () => {
      window.removeEventListener('djafat:auth-changed', onChange);
      window.removeEventListener('djafat:cart-changed', onChange);
    };
  }, [refresh]);

  if (!authed) {
    // FEAT-020 (SPEC-020-07): « Connexion » became « Compte » — log in or create an account.
    return (
      <Button href="/compte" variant="secondary" size="sm">
        <span aria-hidden="true">👤</span> Compte
      </Button>
    );
  }

  const user = getStoredUser();

  return (
    <div className={styles['actions']}>
      <Button href="/panier" variant="secondary" size="sm">
        {count > 0 ? `Panier (${count})` : 'Panier'}
      </Button>
      {/* Sign-out moved to "Mon profil": the header only shows who is signed in. */}
      <Button href="/profil" variant="ghost" size="sm" aria-label="Mon profil">
        👤 {user?.fullName ? user.fullName.split(' ')[0] : 'Profil'}
      </Button>
    </div>
  );
}
