# 11 — Inventaire des écrans & user journeys

Légende priorité : **M** = MVP · **1** = V1.x · **2** = V2.

## 11.1 App CLIENT (web `app.djafat.com` + mobile)

### Auth / onboarding

| Écran                                                    | Prio | Notes responsive                                      |
| -------------------------------------------------------- | ---- | ----------------------------------------------------- |
| Splash / bootstrap (check version, session, réseau)      | M    | —                                                     |
| Saisie téléphone                                         | M    | plein écran, clavier numérique                        |
| Saisie OTP                                               | M    | auto-focus, auto-submit, renvoi avec compte à rebours |
| Onboarding profil (nom, éventuellement e-mail)           | M    | skippable                                             |
| Autorisation localisation / notifications (contextuelle) | M    | après 1re valeur, pas au lancement                    |
| Choix / ajout adresse de livraison                       | M    | GPS · carte · repère · manuel (doc 09-B)              |

### Découverte

| Écran                                       | Prio | Notes                                                                                                                                         |
| ------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Accueil                                     | M    | localisation en tête · barre de recherche · catégories (scroll-x) · restaurants populaires/proches · promotions · état « hors zone »          |
| Sélecteur de localisation / adresses        | M    | liste adresses + carte + recherche                                                                                                            |
| Recherche (résultats)                       | M    | onglets Restaurants/Plats · recherche instantanée · suggestions · historique                                                                  |
| Filtres & tri (sheet)                       | M    | prix, distance, note, délai, livraison gratuite, ouvert maintenant · tri                                                                      |
| Liste par catégorie / cuisine               | M    | grille responsive                                                                                                                             |
| Page restaurant (menu)                      | M    | header (cover/logo/note/avis/distance/ETA/frais/min/horaires) · menu par sections · barre catégories sticky · promos · bouton panier flottant |
| Détail produit + options                    | M    | sheet/dialog · groupes d'options (min/max/requis) · stepper · note · CTA sticky                                                               |
| Avis restaurant (liste)                     | 1    | pagination                                                                                                                                    |
| Infos restaurant (horaires, adresse, carte) | M    | —                                                                                                                                             |

### Panier & commande

| Écran                               | Prio | Notes                                                                                                                         |
| ----------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Panier                              | M    | lignes éditables · sous-total · appel `carts/quote` · alertes indispo · code promo                                            |
| Checkout                            | M    | adresse + repère · mode (livraison/emporter) · créneau (ASAP/programmé) · paiement · instructions · récap · CTA « Commander » | mono-colonne mobile / 2 col ≥ lg                            |
| Sélection moyen de paiement         | M    | cash · mobile money (choix opérateur + numéro) · (carte V2)                                                                   |
| Écran attente paiement Mobile Money | M    | instructions USSD · polling · succès/échec · retry / changer de méthode                                                       |
| Confirmation commande               | M    | code commande · ETA · CTA « Suivre »                                                                                          |
| Suivi commande (temps réel)         | M    | timeline · carte + position livreur · ETA · contacter livreur/resto · code de remise · annuler (selon statut)                 | carte plein écran + sheet (mobile) / carte + panneau (≥ lg) |
| Détail commande passée              | M    | items · montants · reçu · re-commander · aide                                                                                 |
| Historique commandes                | M    | liste, filtres statut, pagination                                                                                             |
| Noter la commande                   | M    | étoiles resto + livreur + commentaire                                                                                         |
| Favoris                             | 1    | restaurants & plats                                                                                                           |
| Réductions / mes promos             | 1    | codes dispo, wallet/avoirs                                                                                                    |

### Compte

| Écran                                               | Prio                    |
| --------------------------------------------------- | ----------------------- |
| Profil (nom, tel, e-mail, langue)                   | M                       |
| Mes adresses (CRUD, défaut)                         | M                       |
| Moyens de paiement enregistrés                      | 2                       |
| Préférences notifications                           | 1                       |
| Aide / Support (FAQ + créer ticket + mes tickets)   | M (FAQ + ticket simple) |
| À propos / mentions légales / CGU / confidentialité | M                       |
| Déconnexion / supprimer le compte                   | M                       |
| État hors ligne (fallback)                          | M                       |

**Total client ≈ 40 écrans** (≈ 28 en MVP).

## 11.2 App RESTAURANT (`restaurant.djafat.com`, responsive ; usage tablette/desktop prioritaire)

| Écran                                                                            | Prio | Notes                                       |
| -------------------------------------------------------------------------------- | ---- | ------------------------------------------- |
| Connexion (tel + OTP, scope restaurant)                                          | M    |                                             |
| Sélecteur d'établissement (si multi-sites)                                       | 1    |                                             |
| **Tableau des commandes** (Nouvelles / En préparation / Prêtes) temps réel + son | M    | kanban ≥ lg, colonnes scrollables mobile    |
| Détail commande + Accepter (temps de prépa) / Refuser (motif) / Prêt             | M    |                                             |
| Historique commandes + recherche                                                 | M    | table → cards mobile                        |
| Menu : catégories (CRUD, ordre)                                                  | M    | drag-and-drop desktop, boutons ordre mobile |
| Menu : produits (CRUD, photo, prix, dispo)                                       | M    | upload image présigné                       |
| Produit : groupes d'options / suppléments (CRUD)                                 | M    |                                             |
| Basculer disponibilité produit (rupture rapide)                                  | M    | toggle en liste                             |
| Horaires d'ouverture                                                             | M    | par jour, gestion minuit                    |
| Bouton « Fermer maintenant » (coup de feu)                                       | M    | override global                             |
| Promotions (CRUD simple)                                                         | 1    |                                             |
| Statistiques (ventes, panier moyen, délais, top produits, taux d'acceptation)    | 1    | KpiTiles + graphes                          |
| Finances : wallet, transactions, demander un virement                            | 1    |                                             |
| Profil établissement (nom, description, logo, cover, zone, min. commande)        | M    |                                             |
| Utilisateurs de l'établissement (rôles)                                          | 1    |                                             |
| Aide / support                                                                   | M    |                                             |

**Total restaurant ≈ 18 écrans** (≈ 12 en MVP).

## 11.3 App LIVREUR (`apps/courier` mobile + `livreur.djafat.com` fallback)

| Écran                                                                                     | Prio         | Notes                                    |
| ----------------------------------------------------------------------------------------- | ------------ | ---------------------------------------- |
| Connexion (tel + OTP)                                                                     | M            |                                          |
| Onboarding livreur (véhicule, pièces, photo) + attente validation                         | M            | upload                                   |
| Accueil **Online/Offline** (toggle géant) + résumé du jour (courses, gains)               | M            |                                          |
| Offre entrante (resto, distances, gain, compte à rebours) Accepter / Refuser              | M            | plein écran, gros boutons, son/vibration |
| Course active — étape « Aller au restaurant » (carte + itinéraire + appel resto)          | M            |                                          |
| Confirmer récupération (checklist, éventuelle photo ticket)                               | M            |                                          |
| Course active — étape « Livrer au client » (carte + appel client + instructions + repère) | M            |                                          |
| Confirmer livraison (photo + code client)                                                 | M            |                                          |
| Échec livraison (motif)                                                                   | M            |                                          |
| Récap course (gain crédité)                                                               | M            |                                          |
| Historique des courses                                                                    | M            |                                          |
| Gains / portefeuille (jour/semaine, détail, demander un virement)                         | 1 (relevé M) |                                          |
| Profil / documents / véhicule                                                             | M            |                                          |
| Aide / support                                                                            | M            |                                          |
| État hors ligne / GPS désactivé                                                           | M            |                                          |

**Total livreur ≈ 16 écrans** (≈ 13 en MVP).

## 11.4 BACK-OFFICE ADMIN (`admin.djafat.com`, desktop-first, mobile = consultation)

| Écran                                                                                                                      | Prio                       | Notes                                        |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------- |
| Connexion (2FA recommandé)                                                                                                 | M                          |                                              |
| **Dashboard** : commandes du jour, GMV, panier moyen, taux d'annulation/rejet, livreurs online, délais moyens, alertes ops | M                          | KpiTiles + graphes ; mobile = KPIs + alertes |
| Commandes (liste, filtres, détail, timeline, forcer annulation, réassigner livreur, contacter)                             | M                          | table → cards mobile                         |
| Restaurants (liste, création, validation, suspension, édition, commission)                                                 | M                          |                                              |
| Menus d'un restaurant (vue admin)                                                                                          | 1                          |                                              |
| Clients (recherche, détail, commandes, suspension)                                                                         | M                          |                                              |
| Livreurs (liste, validation des pièces, suspension, position live sur carte, performance)                                  | M                          |                                              |
| Paiements (liste, détail, statut, **remboursement**, transactions PSP)                                                     | M                          |                                              |
| Grand livre / finances (écritures par compte, soldes, exports)                                                             | 1                          |                                              |
| Réconciliation PSP (rapport d'écarts)                                                                                      | 1                          |                                              |
| Promotions (CRUD, ciblage, usage)                                                                                          | 1                          |                                              |
| Support (tickets, assignation, messages)                                                                                   | M (basique)                |                                              |
| Zones de livraison (dessin polygone, tarifs)                                                                               | 1 (config par script en M) |                                              |
| Points de repère / POIs (CRUD base landmarks)                                                                              | 1                          |                                              |
| Feature flags                                                                                                              | 1                          |                                              |
| Utilisateurs internes & rôles                                                                                              | M                          |                                              |
| Journaux d'audit                                                                                                           | M                          |                                              |
| Paramètres plateforme (frais service, seuils, textes)                                                                      | 1                          |                                              |

**Total admin ≈ 20 écrans** (≈ 10 en MVP).

---

## 11.5 User journeys (parcours critiques)

### J1 — Client : première commande (livraison, Mobile Money) — _cœur du MVP_

```text
Ouvre l'app → saisit tel → reçoit OTP → vérifie → renseigne prénom
→ autorise localisation (ou choisit quartier) → Accueil affiche restaurants proches ouverts
→ ouvre "Chez Fatimé" → ajoute "Poulet braisé" (+ Frites, + Coca) → stepper x2 → Ajouter au panier
→ ouvre Panier → carts/quote (sous-total 16 000 + livraison 1 000 = 17 000) → Checkout
→ adresse: pin GPS + repère "en face de la pharmacie du Marché" + tel → mode Livraison, ASAP
→ paiement: Mobile Money → opérateur + numéro → Commander (Idempotency-Key)
→ order 'placed' + payment 'pending' → écran attente → push USSD → client valide sur son tel
→ webhook → payment 'succeeded' → restaurant notifié "à préparer"
→ Suivi: 'confirmed' (prépa 20 min) → 'preparing' → 'ready'
→ dispatch → offre livreur → 'courier_assigned' (carte + livreur visible) → 'picked_up' → 'on_the_way' (ETA 12 min)
→ livreur arrive → client donne le code 4 chiffres → livreur confirme + photo → 'delivered'
→ client invité à noter (resto + livreur)
```

Points d'échec gérés : OTP non reçu (renvoi/appel), hors zone (message + liste indisponible), paiement échoué (retry / passer en cash si autorisé), livreur introuvable (alerte ops / pickup), réseau coupé pendant le suivi (polling + bandeau).

### J2 — Client : paiement à la livraison

Identique à J1 jusqu'au paiement → choisit « Payer à la livraison » → `order` part directement en attente d'acceptation restaurant (pas d'écran USSD) → à `delivered`, le livreur encaisse, `payment 'succeeded'`, float livreur incrémenté.

### J3 — Restaurant : traiter une commande

```text
Dashboard commandes (son) → carte "Nouvelle" → ouvre → vérifie items → Accepter (prépa 25 min)
→ order 'confirmed' → prépare → marque "Prêt" → order 'ready' → (dispatch gère le livreur)
→ livreur arrive, récupère → carte passe en historique
```

Refus : Refuser + motif (rupture, trop de volume) → client notifié + remboursement auto si déjà payé.

### J4 — Livreur : une course

```text
Ouvre l'app → passe Online → reçoit une offre (resto 1,2 km, course 4,3 km, gain 1 200 FCFA, 30 s)
→ Accepter (Idempotency-Key) → navigation vers resto → "Arrivé" → récupère → "Récupéré"
→ navigation vers client → appelle si besoin → "Arrivé chez le client"
→ saisit le code client → prend la photo → "Livré" → gain crédité → retour écran Online
```

Réseau coupé à "Livré" : action mise en file locale, rejouée à la reconnexion, serveur idempotent.

### J5 — Admin : incident livraison

```text
Alerte ops "aucun livreur depuis 6 min sur DJF-7F3K2" → ouvre la commande
→ voit livreurs online sur la carte → réassigne manuellement OU bascule en "à emporter" + notifie/rembourse la livraison
→ audit_log créé
```

### J6 — Admin : remboursement

```text
Ticket client "commande jamais reçue" → ouvre commande → vérifie 'failed' + absence de preuve
→ Paiements → Rembourser (montant, motif) → refunds 'pending' → provider.refund()
→ écritures ledger inversées → payment 'refunded' → client notifié → ticket résolu → audit_log
```

### J7 — Visiteur web (SEO) → conversion

```text
Recherche Google "livraison poulet N'Djamena" → arrive sur djafat.com/food/poulet (SSG)
→ voit des restaurants + CTA → clique un restaurant (page indexable, menu visible)
→ "Commander" → redirige vers app.djafat.com → parcours J1
→ propose "Ajouter DJAFAT à l'écran d'accueil" (PWA)
```

## 11.6 Récapitulatif volumétrie

| App        | Écrans total | Écrans MVP |
| ---------- | ------------ | ---------- |
| Client     | ~40          | ~28        |
| Restaurant | ~18          | ~12        |
| Livreur    | ~16          | ~13        |
| Admin      | ~20          | ~10        |
| **Total**  | **~94**      | **~63**    |

Chaque écran MVP fera l'objet d'une **spec unique** (objectif, données, états vide/chargement/erreur/hors-ligne, comportement par breakpoint, événements analytics) avant implémentation.
