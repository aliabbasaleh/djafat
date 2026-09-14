'use client';

import { Container, ErrorState, Button } from '@djafat/ui';

/**
 * Root error boundary (docs/03 §3.7). Renders inside the persisted root
 * layout (Header/Footer/MobileNav stay mounted — only the page content
 * below them is replaced), per Next.js's `error.tsx` semantics.
 */
export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Container as="main">
      <ErrorState action={<Button onClick={reset}>Réessayer</Button>} />
    </Container>
  );
}
