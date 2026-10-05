import { Heading, Text, Stack } from '@djafat/ui';
import { Alert } from '@/components/ui-client';

/**
 * Support (Bloc 10, docs/33 §support) — a static contact page, deliberately
 * NOT wired to a ticketing backend: no `support`/`tickets` module exists
 * anywhere in the API yet (checked — Bloc 9's "support tickets" admin item,
 * docs/14 §101, was never built either). Inventing a fake "send a ticket"
 * form here would create an endpoint that silently does nothing — worse than
 * this plain placeholder. Real in-app support is listed as remaining debt in
 * docs/33, not pretended to exist.
 */
export default function SupportPage() {
  return (
    <Stack gap="lg">
      <Heading level={1}>Support</Heading>
      <Alert tone="info">
        Le support en ligne n’est pas encore disponible dans l’application. Pour toute question,
        contactez votre interlocuteur DJAFAT habituel.
      </Alert>
      <Text tone="secondary">
        En cas de problème urgent sur une commande en cours (erreur de livreur, litige client),
        utilisez le motif de refus ou contactez directement le client via les coordonnées fournies à
        la commande.
      </Text>
    </Stack>
  );
}
