# feat(auth,web,mobile): versions 0.24.0 à 0.24.2, comptes clients par e-mail et mot de passe (FEAT-020, API-02)

## Objectif

FEAT-020 — un client crée lui-même son compte (nom complet, téléphone, e-mail, mot de passe),
confirme son e-mail par un code, puis revient avec son e-mail et son mot de passe ou avec un
simple code. Le code part par e-mail (Gmail officiel de DJAFAT, gratuit) ; WhatsApp et SMS sont
prêts et s'activent par la configuration quand DJAFAT aura une API.

## Avant / après

|                        | Avant                                          | Après                                                                                                                         |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| En-tête du site        | « Connexion » → `/connexion`                   | « 👤 Compte » → `/compte`, onglets « Se connecter » / « Créer un compte » ; `/connexion?redirect=X` redirige                  |
| Créer un compte        | seulement par un code SMS/WhatsApp (téléphone) | nom, téléphone, e-mail, mot de passe + confirmation → code par e-mail → connecté, appareil mémorisé                           |
| Se connecter           | code SMS, WhatsApp ou e-mail                   | e-mail + mot de passe ; code demandé sur un appareil inconnu (puis mémorisé 30 jours) ; code seul ; « Mot de passe oublié ? » |
| WhatsApp / SMS éteints | cachés                                         | affichés grisés « Bientôt disponible »                                                                                        |
| « Mon profil »         | nom, e-mail                                    | + définir / changer le mot de passe (alerte par e-mail), + confirmer son numéro                                               |
| Application mobile     | numéro + code SMS                              | écran « Mon compte » : mêmes parcours que le site                                                                             |
| PUT / PATCH / DELETE   | refusés par les navigateurs (CORS)             | autorisés (audit API-02)                                                                                                      |

## Specs et critères couverts

SPEC-020-01 à SPEC-020-12 (`clarified` ; SPEC-020-03, 05 et 06 en v2 après la revue), les 17 critères
FEAT-020-AC01 à AC17. Matrice :
`node scripts/pipeline/check-specs.mjs --matrix FEAT-020` — chaque scénario a un test, sauf les
preuves manuelles : captures du site (SPEC-020-07-SC01, SC06 ; SPEC-020-09-SC03 ;
SPEC-020-10-SC03), envoi Gmail réel (SPEC-020-01-SC06 : code reçu dans la boîte Gmail de DJAFAT le 22 novembre 2026), écran mobile (SPEC-020-08-SC03, indisponible : MOB-01) ; SPEC-020-01-SC07 en revue.

## Changements d'architecture

- Migration **0040_customer_accounts**, additive : `users.password_hash`, `users.password_updated_at`,
  `otp_codes.context` (code lié à la demande qui l'a créé), buts `login_device`, `reset_password`,
  `verify_phone`, tables `auth_challenges` et `trusted_devices`. Retour arrière écrit en SQL dans le
  fichier.
- Après la revue : `EmailChangeService` (changer d'e-mail), `OtpService.requestCodeIfOwned` (même
  chemin pour toute adresse), avis qui rendent leur issue, `FieldValidationError` dans
  `@djafat/core`, fait `emailVerified` dans `CustomerTrustFacts` et la règle de confiance.
- `auth` : `RegistrationService`, `PasswordService`, `TrustedDeviceService`, `PhoneLinkService`,
  deux contrôleurs, un port d'avis (`account-notice.port.ts`) ; `OtpService` gagne la liaison
  facultative (comportement inchangé sans elle). Aucune nouvelle arête de DAG (`auth` → `users`).
- Mots de passe : scrypt de Node (aucune dépendance native), règle pure dans `@djafat/core`.
- `@djafat/sdk` dépend maintenant de `@djafat/core` : la logique cliente des écrans de compte
  (`account-form.ts`) est partagée par le site et l'application (mêmes champs, mêmes messages).
- Configuration : `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (une valeur vide vaut
  absente) ; réglages `password_login_rate_limit_per_ip`, `trusted_device_ttl_seconds`.
- `apps/api/src/main.ts` : liste des méthodes CORS (correctif API-02, préexistant).
- Aucune entrée de baseline ajoutée.

## Vérifications exécutées

Voir `verification.md` (rapport `verify --full`, commit et date en tête) et `progress.md`
(tests par scénario, intégration sur base neuve, parcours navigateur).

## Captures

13 captures d'exécution dans `assets/exec-*` (Chrome sans tête, 390×844), comparées à
FEAT-020-VIS01 à VIS03 dans `progress.md` : un seul écart, le bouton 👁 placé sur la ligne du
libellé et non dans le champ (la maquette ne fixe que sa présence). Les icônes des canaux sont
les SVG du commit `628dce4` de kcerha (branche `fix/login-method-icons`, 0.23.6), repris parce que
FEAT-020 remplace l'ancienne page `/connexion` qu'il modifiait.

## Échecs préexistants

`scripts/pipeline/baselines/known-failures.json` est vide.

## Risques, exceptions, migrations, limites

- **Avant la production** : coller l'adresse Gmail et son mot de passe d'application dans
  `.env.prod` (`EMAIL_PROVIDER=smtp`, `EMAIL_FROM` laissé vide pour l'expéditeur « DJAFAT »), puis appliquer la migration 0040 (l'installation le fait).
  Sans SMTP, l'API démarre mais l'inscription répond 503 `EMAIL_UNAVAILABLE`.
- Gmail gratuit : environ 500 e-mails par jour ; le code n'est demandé qu'aux nouveaux appareils.
- Hypothèses à confirmer (clarifications.md) : profil mobile absent (Q09), « Se déconnecter
  partout » ne révoque pas les appareils mémorisés (Q21), pas de changement de numéro (Q23).
- **Revue indépendante** (`review.md`) : la revue 1 a trouvé 2 bloquants et 4 majeurs, tous corrigés
  avant la PR, dont trois décisions de l'utilisateur (FEAT-020-Q26 à Q28). Revue 2 ciblée : voir
  `review.md`.
- **Commandes au téléphone** : refusées pour un numéro saisi mais non confirmé sur un compte créé en
  ligne ; ce client commande sur le site ou l'application tant que son numéro n'est pas confirmé
  (Q27). **Paiement à la livraison** ouvert au niveau T1 pour un e-mail vérifié (Q26).
- Les codes de connexion par e-mail et de réinitialisation partent **en arrière-plan** : un envoi
  manqué est journalisé, l'écran ne le dit pas (on peut redemander un code) — c'est ce qui empêche de
  deviner qu'une adresse a un compte (Q30).
- Le jeton d'accès d'une session révoquée reste valable jusqu'à 15 minutes (antérieur, docs/19 §13).
- **Fraude possible au paiement à la livraison** : un e-mail vérifié s'obtient facilement ; plusieurs
  comptes T1 (10 000 XAF chacun) restent possibles, freinés seulement par les limites d'inscription
  et par deux absences qui ramènent à T0. À surveiller : les absences des nouveaux comptes e-mail.
- **Compte créé par code, sans mot de passe** : avec une session volée, on peut encore déplacer
  l'e-mail puis poser un premier mot de passe ; le titulaire ne garde que la connexion par téléphone.
  Une décision reste à prendre (par exemple un code au numéro confirmé avant ces deux actions).
- Un envoi d'e-mail manqué (SMTP en panne) ne s'affiche plus : prévoir une alerte d'exploitation sur
  ce message du journal.
- **Conflit attendu avec `fix/login-method-icons`** (0.23.6, non fusionnée) : `connexion/page.tsx`
  (garder la redirection de FEAT-020 ; ses icônes sont déjà reprises), `docs/ROADMAP.md` (garder les
  deux lignes du journal) et `package.json` (garder 0.24.0).
- Merci de fusionner par un **commit de fusion** (pas « squash »), comme les PR précédentes.
