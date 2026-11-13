---
id: SPEC-XXX-01
feature: FEAT-XXX
title: <comportement couvert>
status: draft
version: 1
covers: [FEAT-XXX-AC01]
---

<!--
Spec dérivée de la feature par le skill feature-specs. Une feature peut en
produire plusieurs (une par comportement indépendant).

- status  : draft (générée) -> clarified (grill-me terminé, aucune question
            bloquante ouverte) -> implemented (tests liés et verts)
- version : +1 à CHAQUE modification d'une spec déjà clarifiée ; le brief
            épingle la version, et implémentation + tests doivent viser la même.
- covers  : critères d'acceptation de la feature couverts par cette spec.

Décrire le comportement ACTUEL à partir du code réel (fichier:ligne), jamais
supposer une API ou une capacité qui n'existe pas.
-->

# SPEC-XXX-01 — <titre>

## Comportement observable

<Ce qu'un client HTTP, un écran ou un job observe. Entrées, sorties, effets
persistés, événements émis.>

## Règles métier

- R1 — …

## Scénarios

<!--
IDs stables SPEC-XXX-01-SCnn. Chaque scénario nomme les critères qu'il
vérifie. Un test qui le couvre cite son ID dans son titre ou en commentaire
(`// SPEC-XXX-01-SC01`). Preuve non automatisée : suffixer le titre de
`[evidence: manual]` ou `[evidence: review]` — la revue doit alors la vérifier.
-->

### SPEC-XXX-01-SC01 — <cas nominal>

Critères : FEAT-XXX-AC01

- **Étant donné** …
- **Quand** …
- **Alors** …

## Erreurs et cas limites

<Codes d'erreur (`AllExceptionsFilter`), bornes, concurrence, rejeu
idempotent, données manquantes.>

## Contrats API et données

<Routes `/v1/...`, schémas Zod (`dto/*.schema.ts`), types `@djafat/types`,
tables/migrations touchées. Uniquement ce qui existe ou ce que la spec crée.>

## Autorisations

<Rôle, permission, ownership, step-up MFA, isolation tenant (404 jamais 403).>

## UI et accessibilité

<États d'écran, libellés i18n, focus, lecteurs d'écran, contrastes. Ne jamais
inventer une dimension ou un breakpoint absent des références. "N/A — backend".>

## Références visuelles

<IDs FEAT-XXX-VISnn utilisés et le critère explicite que chacun soutient,
ou "N/A — aucune référence visuelle".>

## Migrations

<Migration Prisma, backfill, compatibilité ascendante, rollback. "N/A — aucune".>

## Hypothèses et questions ouvertes

<Hypothèses techniques raisonnables (à valider en revue) et questions produit
(à trancher par un humain dans clarifications.md).>

## Stratégie de validation

<Niveau de test par scénario : domaine (packages/core), use case (service +
faux Prisma), adaptateur/HTTP, intégration réelle (test:int, Postgres/Redis),
E2E/pilote. Un test entièrement mocké n'est PAS une preuve d'intégration.>

## Modules existants et points d'intégration

<Fichiers et abstractions à réutiliser (chemin:ligne), couche de chaque
changement selon docs/pipeline/architecture-policy.md.>
