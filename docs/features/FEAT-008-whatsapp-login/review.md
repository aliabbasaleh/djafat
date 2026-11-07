# FEAT-008 — Revue qualité

Revue faite par l'agent principal, en relisant les 4 specs avant le diff.

## 1. Résultats déterministes

- Tests écrits **avant** le code et constatés rouges : modules introuvables, méthode absente, configuration refusée.
- Après implémentation : auth 134/134 ; config 15/15 ; `verify:fast` vert ; `check:arch` sans nouvelle violation.
- **Écart de spec corrigé pendant l'implémentation** (FEAT-008-Q03) : j'avais écrit « numéros tchadiens seulement ». Or FEAT-005 accepte les numéros internationaux valides. La spec passe en version 2 pour suivre FEAT-005 (diaspora). Ce changement ne vise pas à faire passer un test : il remet la règle en cohérence avec l'existant.
- **Défaut trouvé par l'exécution réelle** (`e2e-demo.md`) : le SMS coupé consommait le quota partagé avec WhatsApp. Ajout de SPEC-008-01-SC05 (spec en version 2), test rouge, correction, démo rejouée.
- `verify --full` : voir `verification.md`. Tout passe, sauf `build` (échec Expo préexistant) et `test:int`, rouge à l'identique sans FEAT-008 (comparaison dans `pr.md`).

## 2. Constats de revue

| #   | Sévérité         | Emplacement                   | Constat                                                                                                                                                                                                                                               | Correction attendue                                                                                                  |
| --- | ---------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | majeur (corrigé) | `otp.service.ts`              | SMS coupé : un code était écrit et le quota du numéro consommé, ce qui permettait de bloquer la connexion WhatsApp d'un tiers.                                                                                                                        | **Corrigé** : refus avant toute limite et toute écriture (SC05).                                                     |
| 2   | mineur           | `whatsapp-inbound.service.ts` | Le webhook attend l'envoi du code, jusqu'à 2 × 5 s, avant de répondre à Meta. Si Meta abandonne avant, il relivre : le dédoublonnage évite un second code.                                                                                            | Accepté au lancement. Passer par une file d'attente (worker) si le volume l'exige.                                   |
| 3   | risque externe   | règles Meta                   | Le code part en message libre, en réponse au client, pendant la fenêtre de service. C'est ce qui le rend gratuit. Meta propose aussi des modèles « authentification » payants : il faut confirmer que l'usage libre est accepté sur le compte DJAFAT. | À vérifier lors de l'ouverture du compte Meta Business. Repli : modèle d'authentification (payant) via le même port. |
| 4   | mineur           | `otp.service.ts` (verrou)     | Comme pour le SMS, quelqu'un qui connaît un numéro peut le verrouiller 15 min en envoyant de mauvais codes. Le verrou est commun au SMS et à WhatsApp, puisque c'est le même numéro.                                                                  | Comportement existant, accepté.                                                                                      |
| 5   | note             | `auth-methods.ts`             | Le registre est une liste ordonnée. Facebook, Apple et Google s'y ajouteront sans changer le format de la réponse. Sur iPhone, Apple exige « Se connecter avec Apple » si Facebook est proposé.                                                       | Aucune maintenant ; à traiter dans la feature Facebook.                                                              |
| 6   | note             | `whatsapp-inbound.service.ts` | Signature vérifiée en temps constant sur le corps brut ; seuls l'`id` de notre numéro et les messages de moins de 10 min sont traités ; plafond horaire global contre une facture surprise.                                                           | Aucune.                                                                                                              |

## 3. Verdict

**Prêt pour PR**, sans constat bloquant ouvert.

## Matrice

| Critère                      | Spec (version)              | Scénario         | Preuve                                                                       |
| ---------------------------- | --------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| FEAT-008-AC01                | SPEC-008-01@2 (implemented) | SPEC-008-01-SC01 | `apps/api/src/modules/auth/auth-methods.spec.ts`                             |
| FEAT-008-AC01, FEAT-008-AC02 | SPEC-008-01@2 (implemented) | SPEC-008-01-SC02 | `apps/api/src/modules/auth/auth-methods.spec.ts`                             |
| FEAT-008-AC02                | SPEC-008-01@2 (implemented) | SPEC-008-01-SC03 | `apps/api/src/modules/auth/auth-methods.spec.ts`                             |
| FEAT-008-AC02                | SPEC-008-01@2 (implemented) | SPEC-008-01-SC04 | `packages/config/src/env.spec.ts`                                            |
| FEAT-008-AC02                | SPEC-008-01@2 (implemented) | SPEC-008-01-SC05 | `apps/api/src/modules/auth/auth-methods.spec.ts`                             |
| FEAT-008-AC03, FEAT-008-AC04 | SPEC-008-02@2 (implemented) | SPEC-008-02-SC01 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                 |
| FEAT-008-AC03                | SPEC-008-02@2 (implemented) | SPEC-008-02-SC02 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                 |
| FEAT-008-AC03                | SPEC-008-02@2 (implemented) | SPEC-008-02-SC03 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                 |
| FEAT-008-AC04, FEAT-008-AC07 | SPEC-008-02@2 (implemented) | SPEC-008-02-SC04 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                 |
| FEAT-008-AC07                | SPEC-008-02@2 (implemented) | SPEC-008-02-SC05 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                 |
| FEAT-008-AC04                | SPEC-008-02@2 (implemented) | SPEC-008-02-SC06 | `apps/api/src/modules/auth/whatsapp-inbound.service.spec.ts`                 |
| FEAT-008-AC05                | SPEC-008-03@1 (implemented) | SPEC-008-03-SC01 | `apps/api/src/modules/auth/auth-whatsapp.spec.ts`                            |
| FEAT-008-AC05                | SPEC-008-03@1 (implemented) | SPEC-008-03-SC02 | `apps/api/src/modules/auth/auth-whatsapp.spec.ts`                            |
| FEAT-008-AC05                | SPEC-008-03@1 (implemented) | SPEC-008-03-SC03 | `apps/api/src/modules/auth/auth-whatsapp.spec.ts`                            |
| FEAT-008-AC05                | SPEC-008-03@1 (implemented) | SPEC-008-03-SC04 | _manual_                                                                     |
| FEAT-008-AC06                | SPEC-008-04@1 (implemented) | SPEC-008-04-SC01 | `apps/api/src/modules/auth/providers/whatsapp-otp-delivery.provider.spec.ts` |
| FEAT-008-AC06                | SPEC-008-04@1 (implemented) | SPEC-008-04-SC02 | `apps/api/src/modules/auth/providers/whatsapp-otp-delivery.provider.spec.ts` |
| FEAT-008-AC06                | SPEC-008-04@1 (implemented) | SPEC-008-04-SC03 | `apps/api/src/modules/auth/providers/whatsapp-otp-delivery.provider.spec.ts` |
| FEAT-008-AC06                | SPEC-008-04@1 (implemented) | SPEC-008-04-SC04 | `apps/api/src/modules/auth/providers/whatsapp-otp-delivery.provider.spec.ts` |
