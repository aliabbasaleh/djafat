# FEAT-013 — Vérification réelle (2026-11-09)

- `pnpm --filter @djafat/courier build:web` (avec `EXPO_PUBLIC_API_BASE_URL=/v1`)
  → `dist-web/`, sans aucun réglage temporaire ni fichier hors du dépôt.
- Site servi tel quel, API réelle et worker, base remise à zéro. Dans Chromium
  (390×844, GPS simulé près du restaurant) : connexion par SMS, « Passer en
  ligne », course proposée avec compte à rebours, Accepter, « Confirmer la
  récupération », code du client, « Confirmer la livraison » → commande
  `delivered` en base.
- Construction iOS/Android : `turbo run build` pour `@djafat/courier` et
  `@djafat/mobile`, 7 tâches sur 7 réussies.

Vidéo : `apercu/demo-livreur-web.mp4` (non versionnée). Le client et le
restaurant étaient joués par l'API pendant le film ; les écrans du livreur sont
réels.
