'use client';

import { useEffect, useState } from 'react';
import { Inline } from '@djafat/ui';

/**
 * FEAT-022 (SPEC-022-05 R2): the pages of the four steps are the console's
 * own (horaires, menu, profil) plus two new ones; opened from the steps
 * (`?etape=N`), they lead back to them — and step 2 on to the menu.
 */
export function StepBackLink({ next }: { next?: { href: string; label: string } }) {
  const [fromSteps, setFromSteps] = useState(false);
  useEffect(() => {
    try {
      setFromSteps(new URLSearchParams(window.location.search).has('etape'));
    } catch {
      setFromSteps(false);
    }
  }, []);
  if (!fromSteps) return null;
  return (
    <Inline gap="md" wrap>
      <a href="/restaurant">← Retour aux 4 étapes</a>
      {next && <a href={next.href}>{next.label} →</a>}
    </Inline>
  );
}
