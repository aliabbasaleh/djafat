# FEAT-011 — Clarifications (grill-me)

Cadre fixé par l'utilisateur le 2026-11-08 et le 2026-11-09. Aucune question bloquante n'est ouverte.

| ID           | Question                                                   | Bloquant | Statut    | Décision (qui, quand)                                                                                                                          | Specs       |
| ------------ | ---------------------------------------------------------- | -------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FEAT-011-Q01 | Comment la commande est-elle payée ?                       | non      | tranchée  | À la livraison : espèces validées par le livreur, ou Airtel/Tigo à la porte (utilisateur, 2026-11-09).                                         | SPEC-011-01 |
| FEAT-011-Q02 | Quel rôle pour le standardiste ?                           | non      | hypothèse | Le rôle existant `support` (« Support client »), plus `admin` et `super_admin`. Pas de nouveau rôle.                                           | SPEC-011-01 |
| FEAT-011-Q03 | Le client a un panier ouvert dans l'app quand il appelle ? | non      | hypothèse | Il est remplacé par la commande téléphonique : le client a choisi d'appeler.                                                                   | SPEC-011-01 |
| FEAT-011-Q04 | Faut-il un point GPS ?                                     | non      | hypothèse | Facultatif : quartier et repère suffisent (adressage par repères à N'Djamena) ; la carte en direct du client n'a alors pas de point d'arrivée. | SPEC-011-01 |
| FEAT-011-Q05 | SMS/WhatsApp de confirmation au client ?                   | non      | ouverte   | Coût par message : à décider par l'utilisateur. Le standardiste confirme de vive voix pendant l'appel.                                         | —           |
