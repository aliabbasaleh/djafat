---
id: FEAT-XXX
title: <titre court, orienté résultat>
status: draft
type: new
ui: no
---

<!--
Feature écrite À LA MAIN par un humain — point d'entrée du pipeline
(docs/pipeline/README.md). La découverte du problème, la décomposition et la
priorisation se font AVANT, hors pipeline.

Front matter :
- id      : FEAT-NNN (identique au préfixe du dossier docs/features/FEAT-NNN-<slug>/)
- status  : draft | ready | in-progress | done   (ready = prêt pour /feature-specs)
- type    : new | change | bugfix | retrospective
- ui      : yes | no — la feature modifie-t-elle un écran ? (yes => références visuelles,
            obligatoires pour change/bugfix : un état actuel ET un état attendu)

`pnpm check:specs` valide ce fichier. Une section sans objet s'écrit
"N/A — <raison>", jamais vide.
-->

# FEAT-XXX — <titre>

## Objectif utilisateur

<Qui (client, restaurateur, livreur, ops/finance, admin) veut quoi, et pourquoi.
Une ou deux phrases.>

## Comportement attendu

<Ce que l'utilisateur observe une fois la feature livrée. Décrire le résultat,
pas l'implémentation.>

## Périmètre et exclusions

- Dans le périmètre : …
- Hors périmètre : …

## Critères d'acceptation

<!-- Un critère = un comportement vérifiable. IDs stables : FEAT-XXX-AC01, AC02… -->

- **FEAT-XXX-AC01** — <condition observable et vérifiable>
- **FEAT-XXX-AC02** — …

## Dépendances et contraintes

<Modules/applications concernés, règles non négociables du README qui
s'appliquent (Money, ledger, DAG, idempotence, PaymentProvider, secrets),
contraintes de délai, de pays/devise, d'accès externe.>

## Questions ouvertes

<Ce que l'auteur ne sait pas encore. Le stage grill-me les reprendra dans
clarifications.md.>

## Références visuelles

<!--
Obligatoire si ui: yes. Captures VERSIONNÉES dans ./assets/ de préférence.
Nature    : actuel | attendu | inspiration
Autorité  : faisant-foi | contextuel — seule une référence "attendu" peut faire foi ;
            un état actuel ou une inspiration n'est JAMAIS une cible approuvée.
Une capture complète une exigence écrite : elle ne définit jamais à elle seule
une règle métier, une permission ou une interaction.
Si ui: no : "N/A — feature backend uniquement".
-->

| ID             | Source               | Objet | Nature  | Écran / route / état     | Viewport         | Annotations | Critères      | Autorité    |
| -------------- | -------------------- | ----- | ------- | ------------------------ | ---------------- | ----------- | ------------- | ----------- |
| FEAT-XXX-VIS01 | assets/<fichier>.png | …     | attendu | apps/web `/panier`, vide | 390×844 (mobile) | …           | FEAT-XXX-AC01 | faisant-foi |
