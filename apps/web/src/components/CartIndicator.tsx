'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui-client';
import { api } from '@/lib/api';
import { isAuthenticated, clearSession, getStoredUser } from '@/lib/auth-storage';
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
    return (
      <Button href="/connexion" variant="secondary" size="sm">
        Connexion
      </Button>
    );
  }

  const user = getStoredUser();

  return (
    <div className={styles['actions']}>
      <Button href="/panier" variant="secondary" size="sm">
        {count > 0 ? `Panier (${count})` : 'Panier'}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => clearSession()}>
        {user?.fullName ? `Déconnexion — ${user.fullName}` : 'Déconnexion'}
      </Button>
    </div>
  );
}
