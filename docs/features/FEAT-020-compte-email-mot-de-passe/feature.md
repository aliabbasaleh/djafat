---
id: FEAT-020
title: Compte client — inscription et connexion par e-mail et mot de passe, code de vérification
status: ready
type: new
ui: yes
---

<!--
Feature transcrite par l'agent à partir de la demande de l'utilisateur
(2026-11-21, en anglais) et de ses réponses à huit questions à choix
(consignées dans clarifications.md, FEAT-020-Q01 à Q08). Confirmée par
l'utilisateur le 2026-11-21 (« Yes, build it ») : status ready.

Demande d'origine, extraits :
« Instead of having connection, we are going to have account. When you click
on the account, there will be register or login. […] people can register with
their name, like full name, phone number, email, password, confirm password
[…] they will receive on their email an OTP to confirm their email. They will
enter the OTP and the account will open for them. And from there, next time
they can log in with their email and password, or they can just put their
email and they will receive an OTP on their email. […] the best secure way
also their email, their password, and as well as they will receive an OTP on
their email […] we have official Gmail account for the company […] I will
create an app password […] in the .env file and .env example, just create
that variable »
Message suivant : « make an option of the OTP. It can be sent either by
email, or by WhatsApp […] and even phone number. But […] we don't have an API
now, and we don't want to pay for extra services […] »

Ajouts du 2026-11-22, après la revue indépendante : AC16 et AC17, et la fin d'AC13,
d'après les réponses de l'utilisateur aux questions « Cash », « E-mail change » et
« Phone order » (clarifications.md, FEAT-020-Q26 à Q28).
-->

# FEAT-020 — Compte client : inscription et connexion par e-mail et mot de passe

## Objectif utilisateur

Un client crée lui-même son compte DJAFAT (nom complet, téléphone, e-mail, mot de passe),
confirme son e-mail avec un code, puis revient avec son e-mail et son mot de passe, ou avec un
simple code. Le code part aujourd'hui par e-mail, gratuitement, depuis le compte Gmail officiel
de DJAFAT ; WhatsApp et SMS sont prêts pour le jour où DJAFAT aura une API, sans frais d'ici là.

## Comportement attendu

**Entrée.** Sur le site, le bouton « Connexion » de l'en-tête devient « Compte ». Il ouvre la
page `/compte`, avec deux onglets : « Se connecter » (ouvert par défaut) et « Créer un compte ».
Les anciens liens `/connexion?redirect=…` mènent à cette page et gardent leur redirection. Dans
l'application mobile, l'écran de connexion devient le même écran à deux onglets.

**Créer un compte.** Le client saisit son nom complet, son numéro de téléphone (saisi à la
tchadienne, FEAT-005), son e-mail, un mot de passe et sa confirmation, puis valide. Il reçoit un
code à 6 chiffres par e-mail, le saisit, et son compte s'ouvre : il est connecté, son e-mail est
vérifié, cet appareil est mémorisé. Rien n'est créé tant que le code n'est pas confirmé.

**Se connecter.**

- Par e-mail et mot de passe. Sur un appareil mémorisé (code confirmé il y a moins de 30 jours),
  la session s'ouvre directement. Sur un autre appareil, un code est aussi demandé : par e-mail,
  ou par WhatsApp ou SMS au numéro confirmé du compte quand ces canaux sont actifs. Après le
  code, l'appareil est mémorisé 30 jours, sauf si le client décoche « Se souvenir de cet
  appareil ».
- Par un code seul (« ou recevoir un code ») : par e-mail, ou par WhatsApp ou SMS quand ils sont
  actifs.
- « Mot de passe oublié ? » : un code par e-mail, puis un nouveau mot de passe. Toutes les
  sessions et tous les appareils mémorisés du compte sont déconnectés, et un e-mail d'alerte part.

**Canaux de code.** L'e-mail est actif. WhatsApp et SMS sont affichés grisés, « Bientôt
disponible », tant que le serveur ne les déclare pas actifs ; ils s'activent par la configuration
(`.env`), sans changement de code. En développement, les trois marchent avec les faux envois
existants.

**Mon profil.** Le client peut définir un mot de passe (compte créé par WhatsApp ou SMS, qui n'en
a pas) ou le changer en donnant l'actuel ; un e-mail « Votre mot de passe a été modifié »
l'avertit. Il peut aussi lier son téléphone : un code par WhatsApp ou SMS (quand ils sont actifs)
confirme son numéro, et les codes WhatsApp et SMS ouvrent alors ce compte.

**Règles.** Mot de passe de 8 caractères au moins, mots de passe courants refusés. Un seul compte
par numéro de téléphone et par adresse e-mail.

**Envoi des e-mails.** Par le compte Gmail officiel de DJAFAT (SMTP, avec un mot de passe
d'application Google). Les variables existent dans `.env.example` et dans `.env` ; l'utilisateur
colle lui-même l'adresse et le mot de passe d'application dans `.env`.

## Périmètre et exclusions

- Dans le périmètre : API (`auth`, `users`), SDK, site client `apps/web`, application client
  `apps/mobile`, e-mails (code d'inscription, code de connexion, code de nouvel appareil, code de
  réinitialisation, « vous avez déjà un compte », alerte de changement de mot de passe),
  configuration Gmail, migration de la base.
- Hors périmètre : connexion des applications restaurant, livreur et admin (inchangée) ;
  brancher une vraie API WhatsApp ou SMS (pas de budget) ; connexion Google, Facebook ou Apple ;
  suppression de compte ; fusion de comptes ; configuration du serveur de production ;
  changement d'e-mail (existe déjà, FEAT-007).

## Critères d'acceptation

- **FEAT-020-AC01** — Déconnecté, l'en-tête du site affiche « Compte », qui ouvre `/compte` avec les onglets « Se connecter » et « Créer un compte » ; `/connexion?redirect=X` mène à `/compte?redirect=X`. L'application mobile déconnectée montre le même écran à deux onglets.
- **FEAT-020-AC02** — Le formulaire d'inscription demande nom complet, téléphone, e-mail, mot de passe et confirmation, et signale chaque erreur sous son champ : confirmation différente, mot de passe trop court ou trop courant, téléphone ou e-mail invalide, numéro déjà utilisé.
- **FEAT-020-AC03** — Après validation, un code à 6 chiffres part à l'e-mail saisi. Le bon code crée le compte (rôle client, e-mail vérifié, téléphone non vérifié), ouvre la session et mémorise l'appareil ; un code faux ou expiré est refusé et aucun compte n'est créé.
- **FEAT-020-AC04** — Une inscription avec un e-mail déjà utilisé donne la même réponse visible qu'une inscription normale, mais l'e-mail reçu dit « vous avez déjà un compte » au lieu d'un code. Une inscription avec un numéro déjà utilisé est refusée par « Ce numéro a déjà un compte », avec la façon de se connecter.
- **FEAT-020-AC05** — Un mot de passe de moins de 8 caractères, ou présent dans la liste des mots de passe courants, est refusé. Un mot de passe n'est jamais stocké ni journalisé en clair : seul un hachage lent et salé est conservé.
- **FEAT-020-AC06** — E-mail et bon mot de passe sur un appareil mémorisé depuis moins de 30 jours : la session s'ouvre. Sur un autre appareil, un code est demandé ; le bon code ouvre la session et mémorise l'appareil pour 30 jours, sauf si « Se souvenir de cet appareil » est décoché.
- **FEAT-020-AC07** — Un e-mail inconnu et un mauvais mot de passe donnent le même message, « E-mail ou mot de passe incorrect ». Les échecs répétés verrouillent temporairement le compte, et les tentatives sont limitées par adresse et par réseau, comme pour les codes.
- **FEAT-020-AC08** — « Recevoir un code » par e-mail : l'adresse d'un compte reçoit un code qui ouvre la session ; une adresse inconnue obtient la même réponse visible et ne reçoit rien.
- **FEAT-020-AC09** — Les écrans de compte montrent l'e-mail comme canal actif ; WhatsApp et SMS y apparaissent grisés « Bientôt disponible » tant que `GET /auth/methods` ne les déclare pas actifs, et deviennent utilisables dès qu'ils le sont, sans changement de code.
- **FEAT-020-AC10** — « Mot de passe oublié ? » : le bon code reçu par e-mail permet de choisir un nouveau mot de passe ; toutes les sessions et tous les appareils mémorisés du compte sont révoqués et un e-mail d'alerte part. Une adresse inconnue obtient la même réponse visible et ne reçoit rien.
- **FEAT-020-AC11** — Dans « Mon profil », un compte sans mot de passe peut en définir un, et un compte avec mot de passe peut le changer en donnant l'actuel ; un e-mail « Votre mot de passe a été modifié » part et les autres sessions sont déconnectées.
- **FEAT-020-AC12** — Dans « Mon profil », le client confirme son numéro par un code WhatsApp ou SMS quand ces canaux sont actifs ; ensuite, un code WhatsApp ou SMS sur ce numéro ouvre ce compte.
- **FEAT-020-AC13** — Un code WhatsApp ou SMS sur un numéro enregistré par un compte créé par e-mail, dont le numéro n'est pas confirmé, n'ouvre pas ce compte : le message invite à se connecter avec l'e-mail. De même, une commande prise au téléphone pour ce numéro est refusée tant que le numéro n'est pas confirmé.
- **FEAT-020-AC14** — `.env.example` et `.env` contiennent les variables d'envoi Gmail (serveur, port, adresse, mot de passe d'application, expéditeur). Une fois le mot de passe d'application renseigné, les codes arrivent dans la boîte de réception ; sans lui, le développement local garde le faux envoi.
- **FEAT-020-AC15** — Inscriptions, connexions réussies et échouées, changements et réinitialisations de mot de passe et mémorisations d'appareil sont audités ; aucun code, mot de passe ni e-mail complet n'apparaît dans les journaux.
- **FEAT-020-AC16** — Un client dont l'e-mail est vérifié peut payer en espèces à la livraison au premier niveau de confiance (T1), même si son numéro n'est pas confirmé, comme un client au numéro confirmé ; les absences à la livraison le font redescendre comme avant.
- **FEAT-020-AC17** — Changer l'e-mail d'un compte qui a un mot de passe demande le mot de passe actuel ; quand une adresse vérifiée est remplacée, l'ancienne reçoit une alerte et les appareils mémorisés sont oubliés.

## Dépendances et contraintes

- Réutiliser `OtpService` pour tous les codes (hachage, expiration, essais, verrou
  `auth_target_locks`, limites de débit, audit), `AuthService.openSession` pour toutes les
  sessions, `SessionService` (révocation), `UsersService`, `RateLimiterService`, `AuditService`,
  les fournisseurs d'envoi existants (SMTP FEAT-007, WhatsApp FEAT-008, SMS FEAT-006) et
  `GET /auth/methods` (FEAT-008).
- DAG : `auth` ne dépend que de `users` ; aucun module métier n'est touché. Ni argent, ni grand
  livre.
- Données : `users.phone` est obligatoire et unique (`users_phone_active_uk`), `users.email` est
  unique (`users_email_active_uk`). Il faut une migration (hachage du mot de passe, appareils
  mémorisés, inscriptions en attente).
- Secrets : le mot de passe d'application Gmail ne va que dans `.env`, jamais dans Git ;
  `.env.example` n'en montre qu'un exemple vide.
- Un compte Gmail gratuit envoie environ 500 e-mails par jour : le code n'est demandé qu'aux
  nouveaux appareils, ce qui garde DJAFAT loin de cette limite. Au-delà, un service d'envoi
  transactionnel prendra le relais par le même SMTP.
- WhatsApp : le modèle de FEAT-008 (le client écrit « Code DJAFAT », DJAFAT répond) ne coûte rien
  par message selon la tarification publiée par Meta en 2025 (à revérifier à l'activation), mais
  exige un compte WhatsApp Business (Cloud API) que DJAFAT n'a pas encore. Le SMS coûte par
  message.
- Version : 0.24.0 (fonctionnalité), journal dans `docs/ROADMAP.md`.

## Questions ouvertes

Les huit questions posées le 2026-11-21 et les réponses de l'utilisateur sont dans
`clarifications.md` (FEAT-020-Q01 à Q08). Reste ouvert, non bloquant : l'adresse Gmail exacte de
l'expéditeur, que l'utilisateur renseigne dans `.env` avec le mot de passe d'application.

## Références visuelles

| ID             | Source                                       | Objet                                      | Nature  | Écran / route / état                                  | Viewport         | Annotations                                                        | Critères                                    | Autorité    |
| -------------- | -------------------------------------------- | ------------------------------------------ | ------- | ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------ | ------------------------------------------- | ----------- |
| FEAT-020-VIS01 | assets/compte-connexion-attendu-mobile.txt   | maquette texte, onglet « Se connecter »    | attendu | apps/web `/compte`, déconnecté                        | 390×844 (mobile) | disposition choisie par l'utilisateur le 2026-11-21 (FEAT-020-Q04) | FEAT-020-AC01, FEAT-020-AC09                | faisant-foi |
| FEAT-020-VIS02 | assets/compte-inscription-attendu-mobile.txt | maquette texte, onglet « Créer un compte » | attendu | apps/web `/compte`, onglet inscription                | 390×844 (mobile) | champs demandés par l'utilisateur                                  | FEAT-020-AC02                               | faisant-foi |
| FEAT-020-VIS03 | assets/compte-code-attendu-mobile.txt        | maquette texte, étape du code              | attendu | apps/web `/compte`, après inscription ou mot de passe | 390×844 (mobile) | case « Se souvenir de cet appareil » au nouvel appareil seulement  | FEAT-020-AC03, FEAT-020-AC06, FEAT-020-AC10 | faisant-foi |
