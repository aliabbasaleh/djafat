# Feuille de route DJAFAT

> **Version actuelle : 0.19.1** — 10 nov. 2026
> Ce fichier est la feuille de route de référence. Il est mis à jour **à chaque
> version envoyée sur GitHub** (journal des versions en bas, cases cochées au fil
> de l'eau). Toute l'équipe le lit ici, depuis n'importe où.

L'application fonctionne de bout en bout sur le web (site client, restaurant,
admin, app livreur dans le navigateur). La prochaine étape est la **version de
démonstration en ligne** sur djafat.com, puis le pilote à N'Djamena.

## Où on en est

| Étape                                               | État                               |
| --------------------------------------------------- | ---------------------------------- |
| Fonctions du pilote (commande, paiement, livraison) | ✅ faites et vérifiées en vrai     |
| Installation serveur (Docker, HTTPS, sauvegardes)   | ✅ prête, testée en local          |
| Démo en ligne sur djafat.com                        | ⏳ attend le serveur et le domaine |
| Comptes réels (SMS, Airtel, WhatsApp)               | ⏳ démarches en cours côté DJAFAT  |
| Pilote à N'Djamena                                  | à venir                            |

## Phase 1 — technique avant le pilote

- [x] Version web de l'app livreur (FEAT-013)
- [x] Gains, historique et retraits du livreur (FEAT-014)
- [x] Score de confiance client et plafond espèces (FEAT-015)
- [x] Lecture automatique des SMS du téléphone marchand (FEAT-016)
- [x] Commande sans Internet par WhatsApp, SMS ou appel (FEAT-017)
- [x] Repères, point de livraison appris, note vocale (FEAT-018)
- [x] Installation serveur complète : `infra/deploy/` (Docker, HTTPS automatique, sauvegardes)
- [x] Tests d'intégration : 92/93 au vert (étaient ~40)
- [ ] Réécrire le test `walking-skeleton` sur le parcours actuel (dernier test rouge)
- [ ] Mettre la démo en ligne sur djafat.com
- [ ] Alertes en cas de panne et suivi des journaux
- [ ] Écran admin des téléphones passerelles SMS et des SMS mis de côté
- [ ] Connecteur API Airtel Money (FEAT-019) — dès que l'accès API est obtenu
- [ ] Vraies photos des restaurants et des plats

## Phase 1 — à faire côté DJAFAT

- [x] Nom de domaine djafat.com (Namecheap)
- [x] Numéros DJAFAT : WhatsApp/SMS 66 86 89 73, appel 30 10 90 90
- [ ] Serveur Oracle Cloud « Always Free » (choisi) — guide pas à pas : `infra/deploy/README.md`
- [ ] Clé de lecture GitHub (« Deploy key ») ajoutée pour le serveur
- [ ] Les 6 enregistrements DNS chez Namecheap
- [ ] Fournisseur SMS au Tchad (codes de connexion)
- [ ] Comptes marchands Airtel Money et Moov Money, téléphone marchand dédié
- [ ] WhatsApp Business (compte Meta vérifié) sur le 66 86 89 73
- [ ] Contrats restaurants et livreurs relus par un avocat au Tchad
- [ ] Signer 5 à 10 restaurants pilotes, recruter 10 à 15 livreurs
- [ ] Relever les vraies positions GPS des repères (FEAT-018-Q01)
- [ ] Conditions générales et politique de confidentialité

## Phase 2 — pilote à N'Djamena

4 à 6 semaines dans quelques quartiers. On démarre quand : le site et l'app
livreur marchent sur de vrais téléphones, le serveur est en ligne avec les tests
au vert, les contrats sont signés et les numéros marchands actifs.

| Chiffre suivi                                | Objectif proposé |
| -------------------------------------------- | ---------------- |
| Commandes livrées sans incident              | 95 % ou plus     |
| Délai moyen de livraison                     | moins de 45 min  |
| Écart d'espèces chez les livreurs            | 0 FCFA           |
| Transferts Airtel rapprochés automatiquement | 90 % ou plus     |

## Phase 3 — après le pilote

1. Apps mobiles client et livreur sur le Play Store et l'App Store
2. Paiement automatique par l'API officielle Airtel Money
3. Position du livreur en arrière-plan et notifications sur le téléphone
4. Connexion Google et paiement par carte
5. Autres villes (Moundou, Abéché…)

## Décisions à prendre

- [x] Hébergement : gratuit pour commencer (Oracle Cloud Always Free)
- [ ] SMS de confirmation aux clients qui commandent par téléphone (coût par message)
- [ ] Objectif de commandes par jour, quartiers et horaires du pilote
- [ ] Commission finale des restaurants après la période d'essai

## Journal des versions

Chaque envoi sur GitHub ajoute une ligne ici et met à jour `version` dans le
`package.json` racine (0.MINEUR.CORRECTIF : MINEUR pour une fonctionnalité,
CORRECTIF pour une correction ou de la documentation).

| Version | Date         | Contenu                                                                                                                     | Commit    |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0.19.1  | 10 nov. 2026 | Mise en ligne Oracle : script `install.sh` (Docker, pare-feu, clés, démarrage), clé de lecture GitHub, images ARM vérifiées | ce commit |
| 0.19.0  | 10 nov. 2026 | Feuille de route versionnée ; guide « travailler en local » ; tests d'intégration 92/93 ; hébergement gratuit (ARM)         | `41296a8` |
| 0.18.2  | 10 nov. 2026 | Tests d'intégration indépendants de l'heure et du limiteur (90/93)                                                          | `ef13704` |
| 0.18.1  | 10 nov. 2026 | Installation serveur : Docker Compose, HTTPS (Caddy), sauvegardes, guide Namecheap                                          | `2a622a1` |
| 0.18.0  | 10 nov. 2026 | FEAT-018 repères, point appris, note vocale                                                                                 | `c7a4692` |
| 0.17.0  | 9 nov. 2026  | FEAT-017 commande sans Internet (WhatsApp, SMS, appel)                                                                      | `00427ac` |
| 0.16.0  | 9 nov. 2026  | FEAT-016 lecture des SMS du téléphone marchand                                                                              | `ec0ccf1` |
| 0.15.0  | 9 nov. 2026  | FEAT-015 confiance client et plafond espèces                                                                                | `f878b45` |
| 0.14.0  | 9 nov. 2026  | FEAT-014 gains et retraits du livreur                                                                                       | `edc8096` |
| 0.13.0  | 9 nov. 2026  | FEAT-013 app livreur en version web                                                                                         | `06c2387` |
| 0.12.0  | 9 nov. 2026  | FEAT-012 commande par téléphone payée par Airtel, code livreur                                                              | `f5b7fbf` |
