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
pnpm env:init
```

Crée `.env` à partir de `.env.example` et y met de vrais secrets aléatoires (jamais affichés). Sans
cela, l'API démarre mais chaque livraison échoue au retrait du colis. À relancer sans risque : un
`.env` existant est complété, ses vraies valeurs gardées.

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

**Comptes clients par e-mail (FEAT-020)** : sur le site, « Compte » → « Créer un
compte ». Avec `EMAIL_PROVIDER=mock` (la valeur du `.env` local), aucun e-mail ne
part : le code d'inscription, de nouvel appareil ou de mot de passe oublié est
lisible dans Redis :

```bash
docker compose -f infra/docker-compose.yml exec redis redis-cli get "otp:mock:email:vous@exemple.td"
```

Pour envoyer de **vrais e-mails** depuis le Gmail officiel de DJAFAT :

1. Sur le compte Google de DJAFAT : activer la **validation en deux étapes**, puis
   créer un **mot de passe d'application** (myaccount.google.com → Sécurité →
   Mots de passe des applications). Jamais le mot de passe normal du compte.
2. Dans `.env` : `SMTP_USER` = l'adresse Gmail, `SMTP_PASSWORD` = le mot de passe
   d'application : les 16 lettres **sans espaces** (ou entre guillemets :
   `SMTP_PASSWORD="abcd efgh ijkl mnop"` — des espaces sans guillemets cassent le
   chargement du `.env`), puis `EMAIL_PROVIDER=smtp`. Laisser `EMAIL_FROM` **vide** : les clients voient alors « DJAFAT » comme expéditeur (une adresse seule s'afficherait telle quelle).
3. Relancer l'API. Ce mot de passe ne va **jamais** dans Git ni dans un message.

Un compte Gmail gratuit envoie environ 500 e-mails par jour.

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

4. Ouvrir une _Pull Request_ vers `main` sur GitHub, **en brouillon**
   (« Create draft pull request ») tant qu'on envoie encore des modifications :
   sur un brouillon, les contrôles lourds ne tournent pas, ce qui économise les
   minutes GitHub Actions du dépôt (privé, minutes comptées). Quand c'est prêt :
   « Ready for review » ; les contrôles automatiques (Linux et Windows)
   tournent, et on ne fusionne **que si tout est vert**, puis on supprime la
   branche. Une PR qui ne touche que la documentation ne lance que le contrôle
   du format et des specs ; l'analyse de sécurité tourne à chaque envoi.
   Grouper ses envois : chaque envoi sur une PR prête relance les contrôles.
   On ne travaille jamais directement sur `main`.

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
- `minio/minio` refusé au téléchargement : démarrer sans lui, il ne sert qu'aux
  photos — `docker compose -f infra/docker-compose.yml up -d postgres pgbouncer redis mailpit mock-psp mock-sms`.

### Le code de connexion ne marche jamais

- **Chaque clic sur « Envoyer le code » fabrique un nouveau code et annule le
  précédent.** Lire Redis **après** le dernier clic, sinon on lit un code déjà mort.
- Le code vit **5 minutes**. Passé ce délai : redemander, ne pas réessayer l'ancien.
- « Trop de codes demandés » : la limite est de **3 par 10 minutes**, par numéro
  **et** par adresse IP. Pour la remettre à zéro en local :
  ```bash
  docker compose -f infra/docker-compose.yml exec redis redis-cli del "ratelimit:otp:phone:+23566000001" "ratelimit:otp:ip:127.0.0.1"
  ```
- Vérifier qu'une demande est bien **arrivée au serveur** (sinon le problème est
  dans le navigateur, pas dans le numéro) :
  ```bash
  docker compose -f infra/docker-compose.yml exec postgres psql -U djafat -d djafat -c "select target, created_at, attempts from otp_codes order by created_at desc limit 5;"
  ```
  `attempts = 0` sur la dernière ligne = la page n'a jamais envoyé la
  vérification ; aucune ligne récente = la demande n'est jamais partie.

### La page affiche une erreur qui ne correspond à rien

Les pages de connexion affichent désormais la **vraie cause** (serveur
injoignable, limite atteinte, code d'erreur de l'API). Si le message parle de
connexion au serveur alors que l'API tourne, c'est presque toujours un
**paquet JavaScript périmé** dans l'onglet : recharger avec **Ctrl+Shift+R**.
Si ça persiste, arrêter le site, supprimer son dossier `.next`, relancer.

### Le livreur ne reçoit aucune course

Le dispatch ignore un livreur dont la position date de plus de
**120 secondes** (`courier_location_stale_seconds`). Un livreur « en ligne »
mais immobile depuis longtemps ne reçoit donc rien : l'app doit envoyer sa
position (ou appeler `POST /v1/couriers/me/location`) juste avant le test.

### Airtel Money / Tigo Cash n'apparaissent pas au paiement

Deux verrous, volontaires, **tous les deux** nécessaires :

1. `MOBILE_MONEY_WALLETS` renseigné dans `.env` (numéro marchand par opérateur) ;
2. en base, `payment_providers.active` **et** `payment_provider_configs.enabled`
   à `true` — le seed les laisse à `false` exprès, c'est l'exploitation qui
   ouvre le moyen de paiement quand le compte marchand est réellement actif :
   ```bash
   docker compose -f infra/docker-compose.yml exec postgres psql -U djafat -d djafat -c "update payment_providers set active = true where code in ('airtel_money','tigo_cash'); update payment_provider_configs set enabled = true where provider_code in ('airtel_money','tigo_cash');"
   ```

Rappel : `moov_money` n'est **pas** implémenté — le deuxième opérateur est
`tigo_cash` (FEAT-009-Q03) ; `moov_money` n'est qu'un reste du seed d'origine.

### L'app livreur dans le navigateur

Elle tourne sur **http://localhost:8081** (`expo start --web`). Son port doit
figurer dans `API_CORS_ORIGINS`, sinon toutes ses requêtes sont refusées.
