# DJAFAT — Fiche de spécifications design

> Extrait directement de `packages/tokens/src/tokens.json` (source de vérité réelle du projet) et des textes de marque déjà en production dans `apps/web`. Rien d'inventé — chaque valeur ci-dessous existe dans le code à la date du 2026-11-06.

---

## 1. Couleurs

### Marque

| Rôle              | Hex       | Usage observé                                            |
| ----------------- | --------- | -------------------------------------------------------- |
| Primaire          | `#E8531B` | Orange "braise" — boutons, accents, `themeColor` du site |
| Primaire (survol) | `#D6480F` |                                                          |
| Primaire (fort)   | `#C43D0C` |                                                          |
| Sur-primaire      | `#FFFFFF` | Texte sur fond primaire                                  |

### Accent secondaire

| Rôle                | Hex       |
| ------------------- | --------- |
| Secondaire          | `#0E7C66` |
| Secondaire (survol) | `#0B6857` |
| Secondaire (fort)   | `#095346` |

### Fonds

| Rôle                  | Hex                                    |
| --------------------- | -------------------------------------- |
| Canvas (fond de page) | `#FBF7F2` — crème chaud, pas blanc pur |
| Surface (cartes)      | `#FFFFFF`                              |
| Surface alternative   | `#F3EDE4`                              |
| Surface au survol     | `#F7F2EA`                              |

### Texte

| Rôle       | Hex                                        |
| ---------- | ------------------------------------------ |
| Primaire   | `#1B1712` — quasi-noir chaud, pas noir pur |
| Secondaire | `#5B534B`                                  |
| Atténué    | `#8A8078`                                  |
| Désactivé  | `#B8AFA3`                                  |

### Bordures

| Rôle   | Hex       |
| ------ | --------- |
| Défaut | `#E4DBCF` |
| Forte  | `#D2C6B4` |

### États

| État          | Texte/icône | Fond      |
| ------------- | ----------- | --------- |
| Succès        | `#1E8E3E`   | `#E7F5EA` |
| Avertissement | `#B26B00`   | `#FCF1E0` |
| Danger        | `#C62828`   | `#FBEAEA` |
| Info          | `#1565C0`   | `#E8F0FB` |

Anneau de focus : `#E8531B` (= couleur primaire). Voile modal : `rgba(20,15,10,0.55)`.

---

## 2. Typographie

**Police** : `Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`

| Taille  | px  |
| ------- | --- |
| Display | 28  |
| H1      | 22  |
| H2      | 18  |
| H3      | 16  |
| Corps   | 15  |
| Petit   | 13  |
| Légende | 12  |
| Label   | 13  |
| Bouton  | 15  |

**Graisses** : regular 400 · medium 500 · semibold 600 · bold 700 · extrabold 800

**Interlignes** : serré 1.15 · compact 1.3 · normal 1.5 · relâché 1.65

---

## 3. Espacement, rayons, ombres

**Échelle d'espacement (px)** : 0, 4, 8, 12, 16, 20, 24, 32, 40, 56
_(alias : xs=4, sm=8, md=16, lg=24, xl=32, 2xl=40, 3xl=56)_

**Rayons de bordure** : sm 8px · md 12px · lg 16px · xl 24px · pill 999px (boutons/chips arrondis complets)

**Ombres** :

- subtile : `0 1px 2px rgba(27,23,18,0.06)`
- carte : `0 2px 8px rgba(27,23,18,0.08)`
- élevée : `0 8px 24px rgba(27,23,18,0.14)`
- modale : `0 24px 48px rgba(27,23,18,0.24)`

**Mouvement** : rapide 120ms · base 200ms · lent 320ms — easing standard `cubic-bezier(0.2,0,0,1)`

**Points de rupture (px)** : xs 0 · sm 360 · md 600 · lg 905 · xl 1240 · 2xl 1600

**Cible tactile minimale** : 44px (48px pour les actions primaires)

---

## 4. Textes de marque réels (déjà en production)

| Emplacement              | Texte exact                                                |
| ------------------------ | ---------------------------------------------------------- |
| Wordmark                 | **DJAFAT**                                                 |
| Accroche accueil (H1)    | « Vos restaurants préférés, livrés à N'Djamena »           |
| Tagline footer           | « Livraison de repas à N'Djamena, pensée pour l'Afrique. » |
| Ville affichée (en-tête) | 📍 N'Djamena                                               |
| Copyright                | © 2026 DJAFAT — N'Djamena, Tchad.                         |
| Meta description         | Livraison de repas à N'Djamena.                            |

**Sections du footer** (navigation réelle) :

- _Découvrir_ : Restaurants · À propos (bientôt) · Aide (bientôt)
- _Partenaires_ : Devenir livreur (bientôt) · Devenir restaurant (bientôt)
- _Légal_ : Conditions générales (bientôt) · Confidentialité (bientôt) · Contact (bientôt)

**Navigation mobile (icônes)** : 🏠 Accueil · 🍽️ Restaurants · 🛒 Panier · 📍 Adresses

---

## 5. Ton et positionnement (déduit du contenu réel)

- Marché cible : N'Djamena, Tchad — devise FCFA, adressage par repères/quartiers (pas de système d'adresses postales strict).
- Positionnement : chaleureux, local, pas une copie des standards occidentaux ("pensée pour l'Afrique" est le choix de mots exact du footer).
- Palette : chaude et terreuse (crème, braise, terre), jamais de blanc/noir purs — cohérent avec une identité "cuisine maison" plutôt que "tech froide".

---

## 6. Ce qui n'est PAS confirmé comme identité officielle

À ne pas reprendre sans vérification : les couleurs vues sur les cartes restaurants de démonstration (`#0E7C66` vert, `#8A8078` gris, `#C43D0C` rouille, `#C62828` rouge) sont des **couleurs de données de test** (`apps/api/prisma/seed.ts`), pas une palette produit — `#0E7C66` et `#C43D0C` coïncident avec les tokens accent/primaire-fort ci-dessus par choix délibéré du seed, mais `#8A8078` et `#C62828` sont simplement réutilisés depuis la palette texte/danger existante pour des restaurants fictifs.

---

_Fichier généré par lecture directe du code — `packages/tokens/src/tokens.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`. Aucune valeur inventée._
