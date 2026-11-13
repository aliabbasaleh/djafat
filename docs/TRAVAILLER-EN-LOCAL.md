# Travailler sur DJAFAT depuis chez soi

Ce guide permet à un membre de l'équipe de faire tourner **toute l'application
sur son propre ordinateur**, de modifier le code et d'envoyer son travail sur
GitHub. La feuille de route à jour est dans [`ROADMAP.md`](ROADMAP.md).

## 1. Une seule fois : l'accès et les outils

1. **Accès GitHub** : le propriétaire du dépôt invite le collègue
   (GitHub → `aliabbasaleh/djafat` → **Settings** → **Collaborators** →
   **Add people**, rôle _Write_). Le collègue accepte l'invitation reçue par e-mail.
2. **Installer** sur l'ordinateur (Windows, Mac ou Linux) :
   - [Git](https://git-scm.com/downloads)
   - [Node.js 22](https://nodejs.org/) (version LTS)
   - [Docker Desktop](https://www.docker.com/products/docker-desktop/) (lancé)
   - un éditeur, par exemple [VS Code](https://code.visualstudio.com/)
3. **Récupérer le code** (dans un terminal) :

```bash
git clone https://github.com/aliabbasaleh/djafat.git
```

```bash
cd djafat && corepack enable && pnpm install
```

## 2. Lancer l'application

```bash
cp .env.example .env
```

```bash
pnpm infra:up
```

```bash
pnpm --filter @djafat/api db:generate && pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

| Adresse                          | Quoi              |
| -------------------------------- | ----------------- |
| http://localhost:3000            | site client       |
| http://localhost:3002/admin      | administration    |
| http://localhost:3003/restaurant | espace restaurant |
| http://localhost:3001/v1/health  | API               |

**Se connecter** : en local, aucun SMS n'est envoyé. Le code à 6 chiffres est
lisible dans Redis :

```bash
docker compose -f infra/docker-compose.yml exec redis redis-cli get "otp:mock:+23566000001"
```

Comptes de test : `66 00 00 01` client, `66 00 00 02` livreur, `66 00 00 04`
restaurant, `66 00 00 05` standardiste, `66 00 00 06` finance, `66 00 00 07` admin.

App livreur dans le navigateur :

```bash
pnpm --filter @djafat/courier build:web
```

(les fichiers produits sont dans `apps/courier/dist-web`.)

## 3. Faire une modification

1. Partir de `main` à jour (la version de référence), puis créer sa branche :

```bash
git checkout main && git pull
```

```bash
git checkout -b prenom/ce-que-je-change
```

2. Modifier le code, puis vérifier **avant chaque envoi** :

```bash
pnpm verify:fast
```

3. Enregistrer et envoyer (message au format `feat(...)`, `fix(...)`, `docs(...)`) :

```bash
git add -A && git commit -m "fix(web): libellé du bouton commander"
```

```bash
git push -u origin prenom/ce-que-je-change
```

4. Ouvrir une _Pull Request_ vers `main` sur GitHub. Les contrôles
   automatiques (Linux et Windows) tournent ; on ne fusionne **que si tout est
   vert**, puis on supprime la branche. On ne travaille jamais directement sur
   `main`.

**À chaque version envoyée** : ajouter une ligne au journal de
[`ROADMAP.md`](ROADMAP.md), cocher ce qui est fait, et augmenter `version` dans
le `package.json` racine.

## 4. Règles du projet (à lire)

- [`../README.md`](../README.md) — règles non négociables (argent en entiers,
  un seul écrivain du grand livre, modules qui ne s'importent pas n'importe comment…)
- [`../CLAUDE.md`](../CLAUDE.md) — commandes et règles de vérification
- [`pipeline/README.md`](pipeline/README.md) — comment une fonctionnalité passe
  de l'idée au code (dossier `docs/features/FEAT-NNN-*`)
- **Jamais de secret dans Git** : `.env` reste sur l'ordinateur.

## 5. En cas de problème

- `pnpm infra:up` échoue : vérifier que Docker Desktop est lancé.
- Port déjà utilisé : fermer l'autre application, ou arrêter avec `pnpm infra:down`.
- Base dans un état bizarre : `pnpm db:reset` puis `pnpm db:seed` (efface les données locales).
