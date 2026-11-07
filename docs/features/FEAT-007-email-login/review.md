# FEAT-007 — Revue qualité

Revue faite par l'agent principal, en relisant les 3 specs avant le diff. Le
sous-agent `spec-reviewer` n'a pas été invoqué.

## 1. Résultats déterministes

- Tests écrits **avant** le code et constatés rouges :
  - configuration : 1 échec ;
  - flux et adaptateurs : modules introuvables.
- Après implémentation : auth et users 142/142 ; config 13/13 ; `verify:fast` vert.
- Deux échecs intermédiaires venaient de **mes faux**, pas du code ; je n'ai modifié aucune assertion :
  - le faux `getByIdOrThrow` n'était pas cohérent avec le compte trouvé par e-mail ;
  - le serveur SMTP de test refusait l'authentification sans TLS.
- L'adaptateur SMTP est testé contre un **vrai serveur SMTP**.
- Exécution réelle de bout en bout, migration 0030 comprise sur des données existantes : `e2e-demo.md`.
- `verify --full` : voir `verification.md`.
- **Constaté après le premier push, par la CI** : nodemailer@8.0.11 apportait
  15 avis de sécurité (3 « high »). Je l'avais choisi sur sa seule date de
  publication. Le job d'audit était déjà rouge pour des causes antérieures, et
  ce rouge masquait le problème. Corrections :
  - nodemailer passe en **10.2.1** : 0 avis, total revenu à 127, identique à `main` ;
  - ajout de `pnpm check:audit` : rejette tout avis absent de la référence
    nominative, branché dans `verify` et dans `security.yml` ;
  - les nouveaux types ont révélé un **vrai bug** : les délais SMTP étaient passés
    en options par message, donc ignorés. Un serveur muet pouvait bloquer la
    requête. Ils sont maintenant dans les options du transport.

## 2. Constats de revue

| #   | Sévérité         | Emplacement                           | Constat                                                                                                                                                                                                                                   | Correction attendue                                                                                      |
| --- | ---------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | mineur           | `otp.service.ts` (verrou)             | Comme pour les numéros, quelqu'un qui connaît l'adresse d'une victime peut verrouiller sa connexion par e-mail pendant 15 min en envoyant de mauvais codes. La connexion par SMS reste possible, car le verrou est propre à chaque cible. | Comportement existant, accepté. À revoir avec un verrou par couple (cible, IP) si des abus apparaissent. |
| 2   | mineur           | `auth.service.ts`                     | Le code `verify_email` n'est pas lié au compte demandeur (FEAT-007-Q07). Seul le propriétaire de la boîte voit le code, donc le risque est faible.                                                                                        | Ajouter `requested_by` si la revue de sécurité le demande.                                               |
| 3   | note             | `auth.service.ts`                     | `openSession` est factorisé : la connexion par SMS et la connexion par e-mail passent par **le même** contrôle de statut, la même session et le même audit. Les tests SMS existants restent verts.                                        | Aucune.                                                                                                  |
| 4   | note             | migration 0030                        | Uniquement des renommages ; les données existantes sont conservées (prouvé). Les lignes existantes reçoivent la valeur par défaut `channel = 'sms'`.                                                                                      | Aucune.                                                                                                  |
| 5   | note             | `users_email_active_uk`               | L'unicité d'une adresse est garantie par **PostgreSQL**, pas seulement par le code : le 409 vient de la contrainte (P2002).                                                                                                               | Aucune.                                                                                                  |
| 6   | majeur (corrigé) | `smtp-email-otp-delivery.provider.ts` | Délais de connexion, d'accueil et de socket ignorés (2ᵉ argument de `createTransport`).                                                                                                                                                   | **Corrigé** : passés dans les options du transport.                                                      |

## 3. Verdict

**Prêt pour PR**, sans constat bloquant.

## Matrice

| Critère                                     | Spec (version)              | Scénario         | Preuve                                                                    |
| ------------------------------------------- | --------------------------- | ---------------- | ------------------------------------------------------------------------- |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC01 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC02 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC03 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC05                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC04 | `packages/config/src/env.spec.ts`                                         |
| FEAT-007-AC06                               | SPEC-007-01@1 (implemented) | SPEC-007-01-SC05 | `apps/api/src/modules/auth/providers/email-otp-delivery.provider.spec.ts` |
| FEAT-007-AC01                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC01 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC02                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC02 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC02                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC03 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC02                               | SPEC-007-02@1 (implemented) | SPEC-007-02-SC04 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC01, FEAT-007-AC02, FEAT-007-AC06 | SPEC-007-02@1 (implemented) | SPEC-007-02-SC05 | _manual_                                                                  |
| FEAT-007-AC03                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC01 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC03                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC02 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC04                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC03 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC04                               | SPEC-007-03@1 (implemented) | SPEC-007-03-SC04 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC04, FEAT-007-AC06                | SPEC-007-03@1 (implemented) | SPEC-007-03-SC05 | `apps/api/src/modules/auth/auth-email.spec.ts`                            |
| FEAT-007-AC03, FEAT-007-AC04                | SPEC-007-03@1 (implemented) | SPEC-007-03-SC06 | _manual_                                                                  |
