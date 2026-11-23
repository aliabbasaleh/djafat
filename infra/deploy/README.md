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

Oracle offre **sans limite de durée** un serveur ARM de **2 processeurs et 12 Go**
de mémoire (« Always Free », chiffres de la documentation Oracle au 18 nov. 2026).
_(Corrigé le 18 nov. 2026 : ce guide disait 4 processeurs et 24 Go. Au-delà de 2 et 12 Go, un
compte resté gratuit voit ses instances Ampere désactivées puis supprimées au bout de 30
jours (documentation Oracle). Plus de mémoire est possible en passant le compte en « Pay As You Go » : voir
`docs/38-exploitation-demo.md` §3.)_

1. Créer un compte sur [oracle.com/cloud/free](https://www.oracle.com/cloud/free/)
   (une carte bancaire est demandée pour vérifier l'identité ; rien n'est
   prélevé tant qu'on reste dans « Always Free »). Région conseillée :
   **France Central (Paris)** ou **Germany Central (Frankfurt)**.
2. **Compute → Instances → Create instance** : image **Ubuntu 24.04**, forme
   **VM.Standard.A1.Flex** (Ampere), **2 OCPU, 12 Go** (le maximum gratuit), disque 100 Go. Dans
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

**b) Télécharger le code** (branche `main`, la version de référence) :

```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/djafat_deploy -o StrictHostKeyChecking=accept-new" git clone -b main git@github.com:aliabbasaleh/djafat.git && cd djafat && git config core.sshCommand "ssh -i ~/.ssh/djafat_deploy"
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
  À chaque installation, la base reçoit ses **données de référence** (rôles,
  permissions, comptes du grand livre, réglages ; jamais de compte de test, et
  un réglage changé sur le serveur n'est jamais remis à sa valeur par défaut).
  **Premier administrateur** _(ajouté le 18 nov. 2026, mis à jour le 23 nov.)_ : la
  personne crée son compte sur le site (nom, numéro, e-mail et mot de passe) — ou, tant
  que le SMS marche, s'y connecte une fois avec son numéro —, puis, depuis `infra/deploy` :

  ```bash
  docker compose --env-file .env.prod -f docker-compose.prod.yml run --rm migrate node_modules/.bin/tsx prisma/create-super-admin.ts +235XXXXXXXX
  ```

  Elle se reconnecte, active la double authentification (console → « Sécurité »),
  puis donne les autres rôles depuis la console. Les comptes de démonstration
  (numéros publiés, dont un super_admin) ne sont **jamais** créés hors mode démo :
  le script de démo refuse de tourner en production sans `SEED_DEMO=1`.

### Couper le SMS : tout le monde se connecte par e-mail _(ajouté le 22 nov. 2026, FEAT-021)_

Tant que DJAFAT n'a pas de passerelle SMS, le SMS est coupé : clients, administrateurs,
restaurants et livreurs se connectent par **e-mail et mot de passe** (un code par e-mail sur un
appareil inconnu). Les boutons SMS et WhatsApp s'affichent « Bientôt disponible » et s'allument
seuls le jour où leurs réglages sont remplis. **Dans cet ordre**, sinon quelqu'un reste dehors :

1. **L'e-mail marche.** Dans `.env.prod` : `EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.gmail.com`,
   `SMTP_PORT=465`, `SMTP_USER=` l'adresse Gmail de DJAFAT, `SMTP_PASSWORD=` son **mot de passe
   d'application** (sans espaces, ou entre guillemets), `EMAIL_FROM` **vide** (les clients voient
   alors « DJAFAT »). Relancer, puis créer un compte de test sur le site : le code doit arriver.
2. **Chaque membre de l'équipe a un e-mail vérifié et un mot de passe.** Tant que le code
   téléphone marche encore (boîte de test ci-dessus), il se connecte sur le site, ajoute et
   confirme son e-mail dans « Mon profil », puis y définit son mot de passe. Si son e-mail est
   déjà vérifié, « Mot de passe oublié ? » dans son application suffit. **Contrôle avant
   l'étape 3** _(ajouté le 23 nov. 2026, FEAT-021-Q11)_, en lecture seule depuis `infra/deploy` :
   la requête doit ne renvoyer **aucune ligne**.

   ```bash
   docker compose --env-file .env.prod -f docker-compose.prod.yml exec -T postgres \
     psql -U djafat -d djafat -c "BEGIN READ ONLY; SELECT u.id, u.full_name, string_agg(r.role, ', ' ORDER BY r.role) AS roles, u.email_verified_at IS NOT NULL AS email_ok, u.password_hash IS NOT NULL AS mot_de_passe_ok FROM users u JOIN user_roles r ON r.user_id = u.id WHERE r.role <> 'customer' AND u.status = 'active' AND (u.email_verified_at IS NULL OR u.password_hash IS NULL) GROUP BY u.id ORDER BY u.full_name; COMMIT;"
   ```

   Chaque ligne est un compte d'équipe qui serait **bloqué** (sans e-mail vérifié, il ne peut plus
   se connecter) ou **exposé** (sans mot de passe, une session volée suffirait pour changer son
   e-mail puis poser un premier mot de passe). Tant qu'il reste une ligne, ne pas couper le SMS.
   Après la coupure aussi : relancer cette requête après chaque rôle d'équipe accordé ou compte
   réactivé depuis la console ; un compte d'équipe suspendu doit avoir un e-mail vérifié et un mot
   de passe avant d'être réactivé.

3. **Couper le SMS.** Dans `.env.prod` : `SMS_PROVIDER=disabled`, et mettre en commentaire (`#`
   en début de ligne) `SMS_HTTP_URL` et `SMS_HTTP_API_KEY`, sans les effacer : le retour en
   arrière en a besoin. La boîte de test (`mock-sms`) ne sert plus.
4. **Relancer** l'API (`docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api`).
   Elle refuse de démarrer s'il ne reste aucun canal réel (SMS, WhatsApp ou e-mail) : c'est voulu.
5. **Contrôler** : `curl -s https://api.<domaine>/v1/auth/methods` répond `"sms"` et
   `"whatsapp"` avec `"available":false`, `"email"` avec `"available":true` ; puis se connecter
   par e-mail et mot de passe à la console admin, à la console restaurant et à l'application
   livreur.

**Retour en arrière** : remettre `SMS_PROVIDER=http`, retirer le `#` devant `SMS_HTTP_URL` (en
mode démo : `http://mock-sms:4020/send`, la boîte de test, qui tourne avec `--profile demo`) et
devant `SMS_HTTP_API_KEY` (vide en mode démo), puis relancer l'API comme à l'étape 4.
**Le jour où une vraie passerelle SMS existe** : `SMS_PROVIDER=http` avec ses réglages
(`docs/39-comptes-externes.md` §1), sans changer le code.

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

### Surveillance et test des sauvegardes

_(Ajouté le 18 nov. 2026.)_ Deux scripts, à programmer avec `crontab -e` sur le serveur
(détails et réglage des alertes sur téléphone : `docs/38-exploitation-demo.md`) :

```cron
*/5 * * * * cd /home/ubuntu/djafat/infra/deploy && ./healthcheck.sh >> backups/.healthcheck.log 2>&1
0 4 * * 1 cd /home/ubuntu/djafat/infra/deploy && ./restore-check.sh >> backups/.restore-check.log 2>&1
```

- `healthcheck.sh` : sites, API, conteneurs, disque, âge de la sauvegarde, dernier test de
  restauration ; alerte `ALERT_NTFY_URL` (dans `.env.prod`) quand l'état change.
- `restore-check.sh` : restaure la dernière sauvegarde dans une base à part, la vérifie, puis la
  supprime. La base en service n'est jamais modifiée.
