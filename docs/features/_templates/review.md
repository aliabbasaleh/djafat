# FEAT-XXX — Revue qualité

<!--
Produit par /feature-review (sous-agent spec-reviewer, contexte neuf).
Deux parties séparées : ce que les OUTILS ont mesuré (déterministe) et ce que
la REVUE juge (avis argumenté). Ne jamais présenter un avis comme une mesure.
-->

## 1. Résultats déterministes

<Rapport `verify` collé tel quel, avec le commit.>

## 2. Constats de revue

| #   | Sévérité                          | Emplacement     | Constat | Justification            | Correction attendue |
| --- | --------------------------------- | --------------- | ------- | ------------------------ | ------------------- |
| 1   | bloquant / majeur / mineur / note | `fichier:ligne` | …       | spec/critère/règle violé | …                   |

Axes couverts : exactitude fonctionnelle vs specs · régressions · sens des
dépendances · placement des responsabilités · sécurité et autorisations ·
adéquation des tests (testent la SPEC, pas l'implémentation) · abstractions
superflues · critères visuels et accessibilité.

## 3. Verdict

<prêt pour PR | corrections requises (liste) — avec les limites connues.>
