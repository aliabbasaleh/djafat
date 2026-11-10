# Mise en ligne de DJAFAT (un serveur, Docker)

Tout DJAFAT tourne sur **un seul serveur** avec Docker Compose :

| Adresse                      | Service                                   |
| ---------------------------- | ----------------------------------------- |
| `https://djafat.com`         | site client (`apps/web`)                  |
| `https://api.djafat.com`     | API + temps réel (`apps/api`)             |
| `https://admin.djafat.com`   | administration (`apps/admin`)             |
| `https://resto.djafat.com`   | espace restaurant (`apps/restaurant`)     |
| `https://livreur.djafat.com` | app livreur, version web (`apps/courier`) |

Caddy obtient et renouvelle seul les certificats HTTPS. PostgreSQL (+ PostGIS),
Redis et MinIO tournent dans des conteneurs, sans port ouvert sur Internet. Une
sauvegarde de la base est faite chaque nuit dans `infra/deploy/backups/`
(14 jours gardés).

## 1. Le serveur

- Ubuntu 24.04, **4 Go de mémoire, 2 processeurs, 80 Go de disque** au minimum
  (OVH VPS, Hetzner CX32 ou équivalent, en France ou en Allemagne).
- Noter son **adresse IP** (ex. `51.75.12.34`).

## 2. Le domaine chez Namecheap

Namecheap → **Domain List** → `djafat.com` → **Manage** → onglet
**Advanced DNS** → **Add new record**, une ligne par adresse (type **A
Record**, valeur = l'adresse IP du serveur, TTL **Automatic**) :

| Host      | Valeur (IP du serveur) |
| --------- | ---------------------- |
| `@`       | `51.75.12.34`          |
| `www`     | `51.75.12.34`          |
| `api`     | `51.75.12.34`          |
| `admin`   | `51.75.12.34`          |
| `resto`   | `51.75.12.34`          |
| `livreur` | `51.75.12.34`          |

Supprimer les enregistrements par défaut de Namecheap (« parking page », URL
Redirect) s'il y en a. La prise en compte prend de quelques minutes à une heure.

## 3. Installer

Sur le serveur (en SSH) :

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
git clone https://github.com/aliabbasaleh/djafat.git && cd djafat/infra/deploy
```

```bash
DOMAIN=djafat.com ACME_EMAIL=contact@djafat.com MODE=demo ./gen-secrets.sh
```

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml --profile demo up -d --build
```

`gen-secrets.sh` crée `.env.prod` avec des clés aléatoires : ce fichier ne
quitte jamais le serveur et n'est jamais mis dans Git. À la première
installation, la base est créée, les migrations appliquées et (mode démo) les
données de démonstration ajoutées.

## 4. Mode démo et mode réel

- **`MODE=demo`** : les codes de connexion ne partent pas par SMS, ils arrivent
  dans une boîte de test interne, visible **uniquement depuis le serveur** :
  `ssh -L 4020:127.0.0.1:4020 utilisateur@serveur`, puis
  `http://localhost:4020/messages` sur votre ordinateur. Comptes et restaurants
  de démonstration. **Jamais pour de vrais clients.**
- **`MODE=live`** : remplir dans `.env.prod` le fournisseur SMS
  (`SMS_HTTP_URL`, `SMS_HTTP_API_KEY`) et le numéro marchand Airtel
  (`MOBILE_MONEY_WALLETS`) ; démarrer **sans** `--profile demo`. Le serveur
  refuse de démarrer si le SMS est en mode test.

## 5. Au quotidien

Mettre à jour après un nouveau commit :

```bash
git pull && docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Voir l'état et les journaux :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml ps
```

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs -f api
```

Restaurer une sauvegarde (remplace la base !) :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres pg_restore -U djafat -d djafat --clean < backups/djafat-AAAA-MM-JJTHHMM.dump
```

Copier aussi régulièrement `backups/` **hors du serveur** (autre machine ou
stockage externe) : une sauvegarde sur le même disque ne protège pas d'une
panne du serveur.
