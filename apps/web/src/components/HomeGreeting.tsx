'use client';

import { useEffect, useState } from 'react';
import { Greeting } from '@djafat/ui';
import { getStoredUser } from '@/lib/auth-storage';

/**
 * The home page itself is a Server Component (catalog data fetched server
 * side) and the session only exists in the browser's `localStorage` — so
 * the one personal, client-only line lives in its own small boundary rather
 * than forcing the whole page to opt out of server rendering.
 */
export function HomeGreeting() {
  const [name, setName] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const user = getStoredUser();
    setSignedIn(user !== null);
    setName(user?.fullName ?? null);
  }, []);

  if (!signedIn) return null;

  return <Greeting name={name} message="Qu'est-ce qui vous ferait plaisir aujourd'hui ?" />;
}
