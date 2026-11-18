# 39 — Comptes externes à ouvrir par DJAFAT

> Constats d'audit **AUTH-01** (aucun vrai SMS : personne ne peut se connecter en production) et
> **PAY-07** (pas de vrai fournisseur de paiement). Le code est prêt dans les deux cas ; il manque
> des comptes que seule la société DJAFAT peut ouvrir. Ce document dit **ce qu'il faut obtenir**,
> **où le configurer** et **comment vérifier**. Les pièces demandées par chaque opérateur sont à
> confirmer auprès de lui : elles ne figurent pas dans le code.

## 1. Fournisseur SMS pour les codes de connexion (AUTH-01)

**Aujourd'hui** : en démo, les codes arrivent dans une boîte de test interne au serveur, jamais par
SMS. En production, l'API refuse de démarrer avec le faux fournisseur.

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

## 3. Les autres comptes déjà listés

La feuille de route (`docs/ROADMAP.md`, « Ce qui reste à faire ») liste aussi WhatsApp Business,
l'envoi d'e-mails (SMTP) et le stockage des photos. Le code des deux premiers existe et reste
désactivé en production tant que les comptes manquent.

## Qui fait quoi

| Étape                                                   | Qui                       |
| ------------------------------------------------------- | ------------------------- |
| Choisir la passerelle SMS, ouvrir les comptes marchands | DJAFAT (direction)        |
| Fournir les pièces de la société aux opérateurs         | DJAFAT                    |
| Écrire un adaptateur si l'API SMS a un autre format     | Équipe technique          |
| Renseigner `.env.prod` et relancer `install.sh`         | Équipe technique, serveur |
| Faire les vérifications ci-dessus                       | Équipe technique + DJAFAT |
