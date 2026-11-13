# Parcours client complet — vérification du 2026-11-07

Demande de l'utilisateur : « vérifie que le parcours client est complet, de la
commande jusqu'à la livraison sans échec, avant de continuer ».

## Conditions

- API et worker compilés, **sans faux dans le système**. Seuls l'envoi WhatsApp et les codes SMS des comptes de l'équipe passent par les transports factices de développement, dont le code est lu dans Redis.
- PostgreSQL 16 + PostGIS et Redis. **Base reconstruite de zéro** : migrations `0001` à `0033`, données de démarrage.
- **Vrais horaires** du restaurant : passage à ~17 h à N'Djamena, restaurant ouvert, aucun réglage modifié à la main.
- Une seule modification de données, celle qu'un admin ferait : activer `airtel_money`.
- Le livreur passe « en ligne » et envoie sa position **par l'API**, comme l'app livreur. La base n'est pas modifiée à sa place.
- Script versionné : `scripts/e2e/customer-journey.mjs` (`cash` ou `airtel`).

## Résultat final

| Parcours                                      | Étapes réussies |
| --------------------------------------------- | --------------- |
| Espèces à la livraison                        | **22/22**       |
| Airtel Money d'avance (2ᵉ commande du client) | **22/22**       |
| Espèces, rejoué avec le script versionné      | **22/22**       |

Étapes vérifiées, dans l'ordre :

1. Connexion par WhatsApp : le client écrit, DJAFAT répond avec le code, le client ouvre sa session.
2. Choix du restaurant, ouvert.
3. Menu.
4. Ajout d'un produit avec option (poulet × 2, « Entier ») et de frites.
5. Panier.
6. Adresse.
7. Devis : 8 000 + 1 000 = 9 000.
8. Commande, rejouée avec la même clé : même commande, aucun doublon.
9. Suivi en temps réel : 16 événements, jusqu'à « livrée ».
10. Paiement :
    - espèces : la commande passe tout de suite au restaurant ;
    - Airtel : instructions affichées, numéro de transaction donné, transfert enregistré, rapprochement automatique.
11. Réception par le restaurant.
12. Acceptation par le restaurant.
13. Préparation, puis prête.
14. Offre au livreur, puis acceptation.
15. Récupération et code client. Le livreur qui demande le code est refusé (403) ; un mauvais code est refusé (409).
16. Livrée.
17. Montants identiques au devis ; paiement réussi.
18. Historique du client. Un **nouveau** client ne voit pas la commande (404).
19. Portefeuilles du restaurant et du livreur ; grand livre **équilibré** pour la commande.
20. Espèces détenues par le livreur : 9 000 après la commande en espèces, inchangées après la commande Airtel.

## Défauts trouvés, corrigés

| #   | Gravité    | Constat                                                                                                                                                                                                                                                                    | Correction                                                                                                                                                                                            |
| --- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **majeur** | Un livreur qui renvoie « en ligne » (bouton, ou app qui se rouvre) **pendant qu'une commande lui est proposée** repassait de `busy` à `online`. Il ne pouvait alors plus l'accepter (409 `COURIER_NOT_ELIGIBLE`) : la commande était perdue. Reproduit sur une base neuve. | `CouriersService.setStatus` : mise à jour **conditionnelle** (`status NOT IN ('busy','suspended')`), qui résiste aussi à une attribution concurrente. Test d'abord rouge (`couriers-status.spec.ts`). |
| 2   | mineur     | `Content-Type: application/json` avec un corps vide donnait une **500** opaque au lieu d'une 400. Le SDK des apps n'envoie pas cet en-tête sans corps, donc les apps ne sont pas touchées.                                                                                 | Le filtre d'erreurs renvoie le 4xx des erreurs du framework (`VALIDATION_ERROR`). Toute autre erreur reste une 500 sans détail. Test d'abord rouge.                                                   |

## Fausses alertes, dues à mon script et pas à l'application

- Le menu est une liste, et les options se lisent par produit (`GET /products/:id`) : mon script lisait mal ce format.
- Mon script envoyait l'en-tête JSON sans corps : à l'origine du défaut 2.
- Le numéro `+23566000007` est l'**admin** : il voit toutes les commandes, c'est voulu. Le contrôle utilise maintenant un nouveau client.
- Une commande d'un passage interrompu monopolisait le seul livreur : le scénario repart désormais d'une base neuve.
- Il manquait des événements temps réel : mon script coupait la connexion avant le relais du worker, qui passe toutes les 2 s.

## Ce qui n'est pas couvert ici

Écrans des apps (pas de maquettes), Airtel payé à la porte (pas encore construit),
connexion par SMS réel (désactivée au lancement), plusieurs livreurs en concurrence.
