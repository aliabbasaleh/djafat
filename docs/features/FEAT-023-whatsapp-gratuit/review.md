# FEAT-023 — Revue qualité

<!--
Produit par /feature-review (sous-agent spec-reviewer, contexte neuf).
Deux parties séparées : ce que les OUTILS ont mesuré (déterministe) et ce que
la REVUE juge (avis argumenté). Ne jamais présenter un avis comme une mesure.
-->

Périmètre : les commits de la branche au-dessus de `main` (`git diff 413bedc..`, docs_2/ exclu ;
base `dab6e0f` avant le rebase du 2026-11-28) — l'API (`auth` : code à envoyer, réception,
attente, e-mail d'alerte, retrait de la réponse payante de FEAT-008), le SDK, les écrans du site,
de l'application client, des deux consoles et de l'application livreur, le guide Meta, les specs
remplacées en partie (FEAT-008, FEAT-020, FEAT-021, FEAT-024).

Commits avant et après le rebase sur `main` : `24f9fa0` → `cf81cfc`, `7ddde1c` → `7ab03bf`,
`67b6fb4` → `c7259e6`, `b320426` → `fe72313`, `dd32c15` → `12a14f9` ; corrections du tour 2 :
`6214994`.

## 1. Résultats déterministes

Le rapport de `verify --full` au commit final est dans `verification.md` (régénéré après le
rebase sur `main`). Au tour 1 (`cf81cfc`) : format, specs, hygiène, architecture, outillage du pipeline,
Prisma, typecheck 24/24, lint 24/24, tests 24/24, build 16/16, audit, intégration — tout passe ;
e2e indisponible (pas de suite versionnée). `check-specs --matrix FEAT-023` : 0 erreur.

Autres mesures : intégration sur une base neuve, 15 fichiers, 160/160 (dont
`whatsapp-login.int.spec.ts`) ; navigateur sur la pile de la branche, message du client simulé par
`scripts/dev/whatsapp-message.mjs` : 13/13 au tour 1, 16/16 après les corrections du tour 1,
22/22 après celles du tour 2 (voir `progress.md`).

Au tour 2 (corrections `6214994`) : `verify:fast` sans échec (format, specs, hygiène,
architecture, lint 24/24, typecheck 24/24, tests 24/24) ; `whatsapp-code.service.spec.ts` 27/27, le
nouveau test échoue si la confirmation est retirée de `status` ; `whatsapp-login.int.spec.ts` 6/6
sur une base neuve ; `check-specs` : 0 erreur. **Non vérifié** : l'application client Expo sur un écran (son export web échoue
sur un écran existant, sans lien avec FEAT-023), le vrai Meta, le vrai SMTP.

## 2. Constats de revue

### Tour 1 (`cf81cfc`) — corrections requises : 1 majeur, 13 mineurs, 7 notes

| #   | Sévérité | Constat (résumé)                                                                                                                         | Suite                                                                                                                                                                                                           |
| --- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | majeur   | le verrou WhatsApp était celui du numéro : un tiers pouvait le poser par 10 mauvais codes sur `POST /auth/otp/verify` et couper WhatsApp | corrigé : verrou propre `whatsapp:<numéro>` (réception, démarrage, levée) ; SPEC-023-02 R5 v2, SPEC-023-01 R6 v2, Q09 révisée ; test SPEC-023-02-SC08                                                           |
| 2   | mineur   | confirmation en trois écritures : une panne au milieu, et la redélivrance de Meta comptait un échec au vrai propriétaire                 | corrigé : le même message du même expéditeur rend la même issue et termine l'effet, sans échec ; « confirmé » n'est dit qu'une fois le numéro confirmé ; Q19, SPEC-023-02 R6 v2, test SC09                      |
| 3   | mineur   | une issue arrivée se lisait sans limite de temps                                                                                         | corrigé : « expiré » 10 min après la fin de validité ; SPEC-023-03 R1 v2, test SC08                                                                                                                             |
| 4   | mineur   | « Mon profil » : 409 `PHONE_ALREADY_CONFIRMED` sans relire le profil                                                                     | corrigé : traité comme « confirmé » (profil relu, étape d'inscription : « Numéro confirmé »)                                                                                                                    |
| 5   | mineur   | consoles et livreur : un compte refusé laissait la vue WhatsApp en attente                                                               | corrigé : retour au formulaire avec le refus ; SPEC-023-07 R2 v2 ; capture `exec-SPEC-023-07-SC02-refuse-1280.png`                                                                                              |
| 6   | mineur   | les tests de SPEC-023-06 SC03/SC04 portaient sur une branche d'`afterSignup` qu'aucun écran n'appelait                                   | corrigé : la fin de l'inscription passe par `afterSignup` sur le site et dans l'application                                                                                                                     |
| 7   | mineur   | les tests des écrans vérifiaient surtout des constantes                                                                                  | corrigé : `whatsappOutcomeView` (phrase et boutons de chaque issue) utilisé par les cinq vues et testé contre les specs ; numéro rempli testé par `startSignup`                                                 |
| 8   | mineur   | routage FEAT-017 (`DJF1 …` avec « DJAFAT » et 6 chiffres) non testé                                                                      | corrigé : test SPEC-023-02-SC10                                                                                                                                                                                 |
| 9   | mineur   | capture « connecté » : page d'arrivée en erreur                                                                                          | cause trouvée, **défaut de FEAT-022** : `next/image` n'acceptait que `placehold.co`, un logo téléversé faisait planter l'accueil ; corrigé à part (`c7259e6`, `12a14f9`), capture refaite (l'accueil se charge) |
| 10  | mineur   | applications natives : pas de focus sur le titre, annonces Android seulement, erreur sans rôle d'alerte                                  | corrigé : focus du titre (seulement où `sendAccessibilityEvent` existe — react-native-web ne l'a pas), `announceForAccessibility`, rôle `alert`                                                                 |
| 11  | mineur   | site et consoles : focus repris par « Mon profil », émoji lu, régions `status` imbriquées ou insérées avec leur contenu                  | corrigé : une seule région vivante présente dès l'arrivée, avertissement hors région vivante, émojis cachés aux lecteurs d'écran, focus laissé au titre de la vue                                               |
| 12  | mineur   | « Plus tard » en bouton fantôme                                                                                                          | corrigé : bouton secondaire                                                                                                                                                                                     |
| 13  | mineur   | « Numéro confirmé » jamais affiché après la confirmation pendant l'inscription                                                           | corrigé : « ✅ Numéro confirmé : vous pouvez vous connecter par WhatsApp. » puis « Continuer » ; SPEC-023-06 R4 v2 ; capture `exec-SPEC-023-06-SC03-confirme-pendant-inscription-390.png`                       |
| 14  | mineur   | specs anciennes encore sur l'ancien parcours ; versions fausses dans des commentaires de tests                                           | corrigé : SPEC-020-09 v2, SPEC-008-03 v3, SPEC-020-04 v3 (notes) et briefs ; commentaires corrigés                                                                                                              |
| 15  | note     | des commentaires citaient des scénarios de FEAT-023 et comptaient comme preuves                                                          | corrigé : identifiants retirés de ces commentaires                                                                                                                                                              |
| 16  | note     | retour « Recevoir le code par e-mail » pour le nouvel appareil                                                                           | gardé, écrit dans SPEC-023-05 R6 v2                                                                                                                                                                             |
| 17  | note     | VIS03 ne montrait ni le message ni l'envoi depuis un ordinateur ; guillemets sans espaces                                                | VIS03 aligné sur la spec ; guillemets « … » avec espaces insécables                                                                                                                                             |
| 18  | note     | risques résiduels à garder visibles ; motif de Q07 inexact                                                                               | Q07 corrigée ; guide : avec le choix B, les messages libres ne sont lus par personne, « DJAFAT » + 6 chiffres compte un essai raté ; risques repris dans `pr.md`                                                |
| 19  | note     | cinq vues WhatsApp, dont deux identiques                                                                                                 | accepté (règles d'architecture) ; la logique est dans `@djafat/sdk`                                                                                                                                             |
| 20  | note     | commentaire « toujours 200 » contredit par la réponse 500                                                                                | corrigé, et SPEC-023-02 R1 v2                                                                                                                                                                                   |
| 21  | note     | limites connues ; ROADMAP ; `feature.md` en `draft`                                                                                      | `feature.md` en `ready` ; ROADMAP et limites dans la PR                                                                                                                                                         |

Trouvé pendant les captures refaites : l'application livreur (version navigateur) plantait à
l'ouverture de la vue WhatsApp — `AccessibilityInfo.sendAccessibilityEvent` n'existe pas dans
react-native-web ; appel protégé, capture refaite (`fe72313`).

### Tour 2 (`12a14f9`) — corrections requises : 2 mineurs, 6 notes

Clos : constats 1 à 9, 11 à 17, 19 et 20 du tour 1 ; le n° 10 pour les applications natives (la
version web du livreur devient R2-1) ; les n° 18 et 21 vont à la PR (`pr.md`, ROADMAP).

| #    | Sévérité | Constat (résumé)                                                                                                                                                                        | Suite                                                                                                                                                                                                             |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-1 | mineur   | application livreur dans un navigateur, sa forme livrée : le titre sans focus, l'attente et les issues jamais annoncées (pas de `sendAccessibilityEvent`, annonce vide, région retirée) | corrigé (`6214994`) : une région `aria-live="polite"` toujours présente pour l'attente et l'issue (Android, navigateur), annonce sur iPhone seulement, titre focalisé par le DOM ; idem dans l'application client |
| R2-2 | mineur   | SPEC-023-03 R6 v2 (« confirmé de nouveau avant de le dire ») sans test                                                                                                                  | corrigé : test SPEC-023-03-SC05, la confirmation échoue à l'arrivée du message puis l'écran demande : « confirmé », profil confirmé ; il échoue si la confirmation est retirée de `status`                        |
| R2-3 | note     | verrou WhatsApp prouvé seulement avec le faux `OtpService`                                                                                                                              | fait : test d'intégration SPEC-023-02-SC08 (dix mauvais codes sur `POST /v1/auth/otp/verify`, puis 423, puis connexion WhatsApp)                                                                                  |
| R2-4 | note     | correctif `next/image` hors FEAT-023 ; `NEXT_PUBLIC_API_BASE_URL` et `API_PUBLIC_URL` doivent garder le même hôte                                                                       | cité à part dans la PR et la ROADMAP ; `TRAVAILLER-EN-LOCAL` (« Les photos des restaurants ne s'affichent pas ») et `.env.example`                                                                                |
| R2-5 | note     | le natif annonçait l'étape 2 de la connexion, même pour une confirmation, jamais la validité ; émojis lus                                                                               | corrigé : le texte affiché est annoncé (attente avec sa validité, issue) ; textes du SDK sans émoji (test SPEC-023-05 R9), images en décoration cachée                                                            |
| R2-6 | note     | icônes décoratives de VIS02 disparues                                                                                                                                                   | remises et cachées aux lecteurs d'écran (site, consoles, applications), sauf le rond vert des boutons natifs « Ouvrir WhatsApp » : ce bouton n'a qu'un texte, qui serait lu                                       |
| R2-7 | note     | formulations : SC09, stratégies de SPEC-023-02 et 05, section « UI » de SPEC-023-05, Q06                                                                                                | corrigées, sans nouvelle version (formulation, aucun comportement changé)                                                                                                                                         |
| R2-8 | note     | `pr.md` absent ; deux commits non cités ; `verification.md` ancien                                                                                                                      | `pr.md` écrit ; commits cités ; `verification.md` régénéré au commit final                                                                                                                                        |

## 3. Verdict

Tour 2 : « Corrections requises — R2-1 et R2-2 seulement ; prête pour la PR quand ces deux points
seront corrigés ». Les deux sont corrigés dans `6214994`. Tour 3 (vérification de `6214994`) :
interrompu par la limite d'usage du compte (reprise à 15 h, heure de N'Djamena) ; il sera fait
avant la fusion et son résultat ajouté ici.

Axes couverts au tour 1 : exactitude fonctionnelle vs specs · régressions (FEAT-017, 020, 021,
022, 024, consommateurs du SDK) · sécurité (signature, jetons, collisions, verrou, énumération) ·
sens des dépendances et placement · adéquation des tests · abstractions · visuel et accessibilité ·
documentation.
