# 39 — Comptes externes à ouvrir par DJAFAT

> Constats d'audit **AUTH-01** (aucun vrai SMS : personne ne peut se connecter en production) et
> **PAY-07** (pas de vrai fournisseur de paiement). Le code est prêt dans les deux cas ; il manque
> des comptes que seule la société DJAFAT peut ouvrir. Ce document dit **ce qu'il faut obtenir**,
> **où le configurer** et **comment vérifier**. Les pièces demandées par chaque opérateur sont à
> confirmer auprès de lui : elles ne figurent pas dans le code.

## 1. Fournisseur SMS pour les codes de connexion (AUTH-01)

**Aujourd'hui** : en démo, les codes arrivent dans une boîte de test interne au serveur, jamais par
SMS. En production, l'API refuse de démarrer avec le faux fournisseur.

**En attendant une passerelle** _(ajouté le 22 nov. 2026, FEAT-021)_ : le SMS peut être coupé
(`SMS_PROVIDER=disabled`) ; clients et équipe se connectent alors par e-mail et mot de passe, et
le bouton SMS s'affiche « Bientôt disponible ». Procédure, dans l'ordre : `infra/deploy/README.md`
§4, « Couper le SMS ». Le jour où la passerelle existe, la configuration ci-dessous suffit, sans
changer le code.

**À obtenir** : une passerelle SMS qui livre au Tchad (agrégateur, offre « SMS en masse » d'un
opérateur, ou passerelle sur un téléphone Android avec carte SIM), et :

- l'**adresse d'envoi** (URL HTTPS) et une **clé d'accès** ;
- un **nom d'expéditeur** (`DJAFAT`), souvent à faire valider par l'opérateur ;
- le **prix par SMS** et le délai de livraison (un code expire après 5 minutes,
  `otp_ttl_seconds`).

**Ce que le code envoie** (`apps/api/.../http-sms-otp-delivery.provider.ts`) :
`POST <URL>` en JSON `{ "to": "+235…", "from": "DJAFAT", "body": "<le message>" }`, avec
`Authorization: Bearer <clé>` si une clé est donnée. Une réponse 2xx vaut « envoyé » ; une erreur
réseau ou 5xx est retentée une fois. **Si la passerelle choisie attend un autre format**, il faudra
un petit adaptateur côté API, sur le modèle de l'existant : demander la documentation de l'API.

**À configurer** dans `infra/deploy/.env.prod`, puis relancer `install.sh` :

```env
SMS_PROVIDER=http
SMS_HTTP_URL=https://…
SMS_HTTP_API_KEY=…
SMS_SENDER_ID=DJAFAT
```

**À vérifier** : demander un code de connexion sur le site avec un vrai numéro tchadien ; le SMS
arrive et le code fonctionne. C'est la dernière étape de vérification d'AUTH-01.

## 2. Comptes marchands Airtel Money et Moov Money (PAY-07)

**Aujourd'hui** : le client paie en envoyant de l'argent au **numéro marchand** de DJAFAT ; le
paiement est rapproché par la référence du transfert, ou par le SMS de réception que le téléphone
marchand transmet au serveur (FEAT-009, FEAT-016). En démo, les numéros sont factices
(`+23560000010/20/30`).

**À obtenir, pour chaque opérateur** :

- un **compte marchand** au nom de DJAFAT et son **numéro** (celui affiché aux clients) ;
- un **téléphone dédié** avec cette SIM, qui reçoit les SMS de paiement et les transmet au serveur
  (écran « téléphones passerelles » à venir dans la console, voir la feuille de route) ;
- les **frais** de réception et de retrait, et le **plafond** par transaction ;
- pour plus tard, l'**accès à l'API marchand** (Airtel : FEAT-019) pour confirmer les paiements
  automatiquement et rembourser sans passer par la main.

**À configurer** (`.env.prod`, un seul paramètre, aucun code) :

```env
MOBILE_MONEY_WALLETS=airtel_money=+235XXXXXXXX,moov_money=+235XXXXXXXX
```

Un portefeuille absent de cette liste n'est jamais proposé aux clients.

**À vérifier** : une vraie commande payée de 100 FCFA par portefeuille, rapprochée
automatiquement ; puis une annulation de cette commande : le remboursement apparaît dans
« Remboursements » de la console (à renvoyer à la main tant qu'il n'y a pas d'API, `docs/37`).

## 3. WhatsApp pour les connexions (FEAT-023)

**Aujourd'hui** : WhatsApp est grisé « Bientôt disponible » partout. Le code est prêt : l'écran
affiche un code, le client l'**envoie** sur WhatsApp au numéro de DJAFAT, et l'écran se connecte
tout seul. **DJAFAT n'envoie aucun message** pour une connexion : Meta ne facture que les messages
envoyés par une entreprise (depuis le 1er octobre 2026, chacun est payant), donc les connexions ne
coûtent rien, quel que soit leur nombre. Après chaque connexion par WhatsApp, le client reçoit un
**e-mail** gratuit « Nouvelle connexion par WhatsApp ».

**Ce qu'il faut obtenir** (DJAFAT) :

1. Un compte **Meta Business** au nom de DJAFAT (business.facebook.com), vérifié si Meta le
   demande.
2. Un **numéro de téléphone** pour WhatsApp — voir les deux choix ci-dessous.
3. Une **application Meta** (developers.facebook.com) avec le produit **WhatsApp**, reliée à ce
   compte et à ce numéro, et un **utilisateur système** avec un jeton d'accès permanent.

**Quel numéro relier ?** Le code marche avec n'importe quel numéro ; c'est un choix de DJAFAT :

| Choix                                                     | Ce qui change                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Un second numéro**, pour les connexions seulement    | Le 66 86 89 73 reste dans l'application WhatsApp Business pour les commandes, comme aujourd'hui (réglage du site `NEXT_PUBLIC_DJAFAT_ORDER_NUMBER`). Les connexions vont au second numéro (`WHATSAPP_BUSINESS_NUMBER`) : rien n'est facturé. Seul cas payant : quelqu'un qui enverrait une commande « DJF1 … » à ce numéro-là reçoit une réponse automatique.                                      |
| **B. Le numéro des commandes** 66 86 89 73, pour les deux | Un seul numéro à faire connaître. Mais un numéro relié à l'API ne sert plus, en principe, dans l'application WhatsApp Business (sauf « coexistence », si Meta la propose au Tchad). Les commandes par WhatsApp sont alors passées automatiquement (FEAT-017), et **chaque réponse** (numéro de commande, total, code pour le livreur) **est un message payant**. Les connexions restent gratuites. |

À savoir pour le choix B : les messages libres que les clients écrivent à ce numéro (questions,
réclamations) arrivent à l'API, qui ne lit que les codes et les commandes « DJF1 … » : **personne ne
les voit**. Il faut alors un autre moyen de répondre aux clients (un numéro pour le service client,
par exemple). Dans les deux choix, un message qui contient « DJAFAT » et un nombre de 6 chiffres
est lu comme un code : s'il ne correspond à aucun code en attente, il compte comme un essai raté
pour ce numéro (10 essais ratés bloquent la connexion par WhatsApp de ce numéro pendant 15 minutes).

**Brancher le webhook** (page WhatsApp > Configuration de l'application Meta) :

- URL de rappel : `https://api.<domaine>/v1/auth/whatsapp/webhook` ;
- jeton de vérification : une valeur au hasard (par exemple `openssl rand -hex 24`), la même que
  `WHATSAPP_VERIFY_TOKEN` ;
- s'abonner au champ **`messages`**. Meta signe chaque envoi avec la clé secrète de l'application ;
  l'API refuse un envoi mal signé.

**Où le configurer** : dans `.env.prod` sur le serveur (jamais dans Git ni dans un document), puis
relancer `install.sh` :

```bash
WHATSAPP_PROVIDER=cloud
WHATSAPP_BUSINESS_NUMBER=+235…        # le numéro relié, au format international
WHATSAPP_PHONE_NUMBER_ID=…            # « ID du numéro de téléphone » dans Meta (pas le numéro)
WHATSAPP_APP_SECRET=…                 # « Clé secrète » de l'application (Paramètres > Général)
WHATSAPP_VERIFY_TOKEN=…               # le jeton choisi pour le webhook
WHATSAPP_ACCESS_TOKEN=…               # le jeton de l'utilisateur système
```

L'API refuse de démarrer avec `WHATSAPP_PROVIDER=cloud` s'il manque une de ces valeurs : c'est
voulu. Les connexions n'envoient rien ; le jeton d'accès sert seulement aux réponses des
commandes par WhatsApp (choix B).

**À vérifier** :

1. Le site, l'application client et les applications d'équipe montrent WhatsApp **sans**
   « Bientôt disponible ».
2. Depuis un téléphone dont le numéro est confirmé sur un compte : « Se connecter » → WhatsApp →
   « Ouvrir WhatsApp » → envoyer le message → la page se connecte ; l'e-mail « Nouvelle connexion
   par WhatsApp » arrive.
3. Depuis un numéro sans compte : la page dit « Ce numéro n'est confirmé sur aucun compte » et
   propose « Créer un compte ».
4. Dans la facturation WhatsApp de Meta : **aucun message envoyé par DJAFAT** pour ces connexions.

## 4. Les autres comptes déjà listés

La feuille de route (`docs/ROADMAP.md`, « Ce qui reste à faire ») liste aussi l'envoi d'e-mails
(SMTP) et le stockage des photos. Le code existe et reste désactivé en production tant que les
comptes manquent.

## Qui fait quoi

| Étape                                                   | Qui                       |
| ------------------------------------------------------- | ------------------------- |
| Choisir la passerelle SMS, ouvrir les comptes marchands | DJAFAT (direction)        |
| Ouvrir le compte Meta, choisir le numéro WhatsApp       | DJAFAT (direction)        |
| Fournir les pièces de la société aux opérateurs         | DJAFAT                    |
| Écrire un adaptateur si l'API SMS a un autre format     | Équipe technique          |
| Renseigner `.env.prod` et relancer `install.sh`         | Équipe technique, serveur |
| Faire les vérifications ci-dessus                       | Équipe technique + DJAFAT |
