# FEAT-001 — Clarifications (grill-me)

Rétrospectif : les décisions ci-dessous sont celles prises lors du correctif
`cc3b207` (2026-10-14), retrouvées dans son message de commit et le
commentaire de `orders.service.ts:216-239`, et dans docs/36 §6.3.

| ID           | Question                                                                                        | Bloquant | Statut    | Décision (qui, quand)                                                                                                                                        | Specs                         |
| ------------ | ----------------------------------------------------------------------------------------------- | -------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| FEAT-001-Q01 | Faut-il aussi refuser l'ajout au panier quand le restaurant est fermé ?                         | oui      | tranchée  | Non : naviguer et préparer un panier après la fermeture est sans danger ; la garde est au moment de l'engagement (équipe DJAFAT, commit cc3b207, 2026-10-14) | SPEC-001-01                   |
| FEAT-001-Q02 | `PAUSED` et `UNAVAILABLE` doivent-ils être refusés comme `CLOSED` ?                             | oui      | tranchée  | Oui : la garde est « est-ce OPEN » (équipe DJAFAT, commit cc3b207, 2026-10-14)                                                                               | SPEC-001-01                   |
| FEAT-001-Q03 | Quel code HTTP : 409 ou 422 ?                                                                   | non      | hypothèse | 409 `ConflictException` : l'état de la ressource empêche l'action, la requête elle-même est valide                                                           | SPEC-001-01                   |
| FEAT-001-Q04 | Quel délai d'expiration pour une commande `placed` qu'un restaurant OUVERT ne confirme jamais ? | oui      | ouverte   |                                                                                                                                                              | hors périmètre — docs/36 §6.3 |
