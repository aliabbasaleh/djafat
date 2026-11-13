# FEAT-010 — Démonstration de bout en bout (2026-11-07)

Exécution réelle, sans faux dans le système :

- API et worker compilés ;
- PostgreSQL 16 + PostGIS, base reconstruite de zéro (migrations jusqu'à `0033`, données de démarrage) ;
- Redis ;
- `MOBILE_MONEY_WALLETS=airtel_money=+23560000010`.

Réglages de démonstration, dans la base locale seulement :

- plafond abaissé à **2 500 XAF** (`courier_cash_ceiling_minor`) ;
- restaurant ouvert 24 h/24 ;
- position du livreur rafraîchie avant chaque répartition.

## Une erreur de ma démonstration, corrigée

Lors d'un premier passage, j'ai vidé Redis (`flushall`) **après** le démarrage du
worker. Cela a effacé ses tâches répétées : la répartition ne tournait plus
(`dispatch_attempts` restait à 1). Les deux constats « pas d'offre pendant le
blocage » puis « toujours pas d'offre après le déblocage » ne prouvaient donc
rien. Le worker a été redémarré, et le scénario rejoué en ne vidant que les clés
OTP. Les résultats ci-dessous viennent de ce second passage, et le nombre de
tentatives de répartition montre que le worker tournait bien.

## Scénario

| #   | Action                                                       | Résultat observé                                                                                                                                     |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Livreur avant toute livraison (`GET /v1/couriers/me/cash`)   | détenu 0 / plafond 2 500 / non bloqué                                                                                                                |
| 2   | Commande A en espèces (3 000), livrée                        | paiement `succeeded` ; détenu 3 000 → **bloqué**                                                                                                     |
| 3   | Reversement de 3 000 (étapes 5 à 7 ci-dessous)               | détenu 0, débloqué ; la commande B, prête entre-temps, lui est **proposée** après redémarrage du worker                                              |
| 4   | B livrée (2 000) puis C livrée (3 000)                       | détenu 2 000 (non bloqué), puis 5 000 → **bloqué**                                                                                                   |
| 5   | Commande D prête, livreur bloqué, position fraîche           | **aucune offre** en 50 s, alors que la répartition a tourné **6 fois** (`dispatch_attempts` 0 → 6)                                                   |
| 6   | Transfert de 5 000 enregistré, affecté au livreur            | `cashHeld` 0 ; livreur **débloqué** ; D lui est **proposée**                                                                                         |
| 7   | Transfert de 5 000 affecté alors qu'il détenait 3 000        | 409 `REMITTANCE_EXCEEDS_CASH_HELD`, transfert resté `unmatched`                                                                                      |
| 8   | Le même transfert affecté une 2ᵉ fois                        | 409                                                                                                                                                  |
| 9   | Vue équipe (`GET /v1/deliveries/couriers/:id/cash`)          | identique à la vue du livreur                                                                                                                        |
| 10  | Un client appelle la vue équipe, puis `couriers/me/cash`     | 403 / 403                                                                                                                                            |
| 11  | `CASH_FLOAT` du livreur dans le grand livre                  | débits 3 000 + 2 000 + 3 000, crédits `cash_reconciliation` 3 000 + 5 000 : solde **0** ; chaque reversement est un groupe équilibré (3 000 = 3 000) |
| 12  | SQL : transfert `matched` avec un paiement **et** un livreur | refusé par `mobile_money_receipts_match_ck`                                                                                                          |

Services arrêtés après la démonstration.
