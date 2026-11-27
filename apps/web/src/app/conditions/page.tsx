import type { Metadata } from 'next';
import { Container, Heading, Stack, Text } from '@djafat/ui';

export const metadata: Metadata = {
  title: "Conditions d'utilisation — DJAFAT",
};

/**
 * « Conditions d'utilisation » (FEAT-022-Q05): the page the sign-up box links
 * to. Provisional text, marked « à compléter par DJAFAT »: DJAFAT replaces it
 * before the pilot. The date of acceptance is kept with each courier and
 * restaurant application.
 */
export default function ConditionsPage() {
  return (
    <Container as="main" maxWidth={720}>
      <Stack gap="lg">
        <Heading level={1}>Conditions d’utilisation</Heading>
        <Text tone="secondary">
          Texte provisoire, à compléter par DJAFAT avant l’ouverture du service.
        </Text>
        <section>
          <Stack gap="sm">
            <Heading level={2}>1. Le service DJAFAT</Heading>
            <Text>
              DJAFAT met en relation, à N’Djamena, des clients qui commandent des repas, des
              restaurants qui les préparent et des livreurs qui les apportent. À compléter par
              DJAFAT.
            </Text>
          </Stack>
        </section>
        <section>
          <Stack gap="sm">
            <Heading level={2}>2. Votre compte</Heading>
            <Text>
              Une personne a un seul compte, avec son adresse e-mail et son numéro de téléphone.
              Gardez votre mot de passe secret. À compléter par DJAFAT.
            </Text>
          </Stack>
        </section>
        <section>
          <Stack gap="sm">
            <Heading level={2}>3. Livreurs et restaurants</Heading>
            <Text>
              Un livreur ou un restaurant envoie ses papiers à DJAFAT, qui les vérifie avant de le
              valider. Les photos des papiers ne sont visibles que par l’équipe de DJAFAT et par
              leur propriétaire. À compléter par DJAFAT.
            </Text>
          </Stack>
        </section>
        <section>
          <Stack gap="sm">
            <Heading level={2}>4. Paiements</Heading>
            <Text>
              Les paiements passent par Mobile Money (Airtel Money, Moov Money) ou en espèces à la
              livraison. À compléter par DJAFAT.
            </Text>
          </Stack>
        </section>
        <section>
          <Stack gap="sm">
            <Heading level={2}>5. Vos données</Heading>
            <Text>
              DJAFAT n’utilise vos données que pour faire fonctionner le service. À compléter par
              DJAFAT.
            </Text>
          </Stack>
        </section>
      </Stack>
    </Container>
  );
}
