import { Container, EmptyState } from '@djafat/ui';
import { Button } from '@/components/ui-client';

/**
 * Global 404 (docs/03 §3.7) — also what `notFound()` renders for an unknown
 * or non-public restaurant/product slug (docs/20 §3, §52 IDOR: a suspended
 * or draft restaurant renders identically to a genuinely unknown one).
 */
export default function NotFound() {
  return (
    <Container as="main">
      <EmptyState
        icon="🍽️"
        title="Page introuvable"
        message="Ce restaurant ou ce plat n’existe pas, ou n’est plus disponible."
        action={<Button href="/">Retour à l’accueil</Button>}
      />
    </Container>
  );
}
