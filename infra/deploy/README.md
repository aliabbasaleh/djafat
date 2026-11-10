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

### Gratuit pour commencer : Oracle Cloud « Always Free »

Oracle offre **sans limite de durée** un serveur ARM de 4 processeurs et 24 Go
de mémoire, assez pour toute la démo et le pilote.

1. Créer un compte sur [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
   (une carte bancaire est demandée pour vérifier l'identité ; rien n'est
   prélevé tant qu'on reste dans « Always Free »). Région conseillée :
   **France Central (Paris)** ou **Germany Central (Frankfurt)**.
2. **Compute → Instances → Create instance** : image **Ubuntu 24.04**, forme
   **VM.Standard.A1.Flex** (Ampere), **4 OCPU, 24 Go**, disque 100 Go. Dans
   « Add SSH keys », choisir **Generate a key pair for me** et cliquer **Save
   private key** (garder ce fichier précieusement : c'est la clé du serveur) ;
   créer. Noter l'**adresse IP publique**.
3. Ouvrir les ports web chez Oracle : **Networking → Virtual cloud networks →
   (le réseau) → Security Lists → Default Security List → Add Ingress Rules** :
   source `0.0.0.0/0`, protocole TCP, port de destination **80** ; recommencer
   avec **443**. (Le pare-feu du serveur lui-même est ouvert par `install.sh`.)

Le script détecte le processeur ARM et choisit l'image PostGIS adaptée.
Si « Out of capacity » s'affiche à la création, réessayer plus tard ou dans une
autre zone de disponibilité : c'est fréquent sur l'offre gratuite.

### Payant (plus simple)

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

**Se connecter au serveur** depuis son ordinateur (Oracle : utilisateur
`ubuntu`, clé SSH choisie à la création) :

```bash
ssh -i chemin/vers/la-cle-privee.key ubuntu@51.75.12.34
```

**a) Une clé pour lire le dépôt GitHub** (il est privé). Sur le serveur :

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/djafat_deploy -C "serveur djafat" && cat ~/.ssh/djafat_deploy.pub
```

Copier la ligne affichée (`ssh-ed25519 …`), puis sur GitHub :
`aliabbasaleh/djafat` → **Settings** → **Deploy keys** → **Add deploy key** →
titre « serveur djafat », coller la clé, **ne pas** cocher « Allow write
access » → **Add key**.

**b) Télécharger le code** (remplacer la branche par `main` une fois la
_Pull Request_ n°1 fusionnée) :

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/djafat_deploy -o StrictHostKeyChecking=accept-new" git clone -b claude/compassionate-franklin-k23vcj git@github.com:aliabbasaleh/djafat.git && cd djafat && git config core.sshCommand "ssh -i ~/.ssh/djafat_deploy"
```

**c) Tout installer et démarrer** (Docker, pare-feu, clés secrètes,
construction, démarrage — 10 à 20 minutes la première fois) :

```bash
DOMAIN=djafat.com ACME_EMAIL=contact@djafat.com MODE=demo ./infra/deploy/install.sh
```

`install.sh` peut être relancé sans risque : il met le code à jour et
redémarre, sans jamais recréer les clés. Les clés aléatoires sont dans
`infra/deploy/.env.prod` : ce fichier ne quitte jamais le serveur et n'est
jamais mis dans Git. À la première installation, la base est créée, les
migrations appliquées et (mode démo) les données de démonstration ajoutées.

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

Mettre à jour après un nouveau commit (depuis le dossier `djafat`) :

```bash
./infra/deploy/install.sh
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
