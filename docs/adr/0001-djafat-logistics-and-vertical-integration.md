# ADR-0001 — DJAFAT comme réseau logistique multi-restaurants, et préparation à l'intégration verticale

## 1. Title

DJAFAT comme réseau logistique multi-restaurants + préparation à l'intégration verticale.

## 2. Status

**Accepté** — architecture uniquement. Aucune fonctionnalité de groupage, de
marketplace élargie, d'inventory ou de supply n'est implémentée par cet ADR.

Premier ADR du dépôt. Suit la convention déclarée dans
[`docs/13-structure-git-et-dossiers.md`](../13-structure-git-et-dossiers.md)
§106 : `docs/adr/NNNN-titre.md`. Les décisions `AD-01…AD-14` et les décisions
verrouillées `A1…A9` de
[`docs/15-audit-corrections.md`](../15-audit-corrections.md) restent en vigueur
et ne sont pas renumérotées ; cet ADR s'y ajoute sans les remplacer.

## 3. Date

2026-09-30 — après le Bloc 6.1
([`docs/25`](../25-bloc-6-delivery-dispatch.md)), avant le Bloc 7.

## 4. Context

Le Bloc 6 a livré un cœur de dispatch réel : machine à 10 états, recherche
PostGIS par rayon, offres à 30 s, verrouillage transactionnel, et depuis le
Bloc 6.1 un invariant « un livreur = une livraison active » garanti en base.

Ce cœur est correct pour ce qu'il fait. La question que pose cet ADR est
différente : **le modèle actuel enferme-t-il DJAFAT dans « un restaurant → une
commande → une livraison » ?**

La réponse est partiellement oui, et il vaut mieux savoir précisément où avant
d'écrire le Bloc 7 par-dessus.

### 4.1 Ce que l'inspection du code a réellement trouvé

Neuf hypothèses ont été cherchées dans le schéma, les migrations, les services
et l'API. Le résultat est plus favorable que prévu : **cinq n'existent pas**, et
celles qui existent sont contenues.

| Hypothèse cherchée                                   | Verdict          | Où                                                                               |
| ---------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| Une livraison = exactement une commande              | ✅ **existe**    | `Delivery.orderId @unique` (schema ligne 715, migration `0010_orders` ligne 125) |
| Un livreur = une livraison active                    | ✅ **existe**    | Index unique partiel `deliveries_one_active_per_courier_idx` (migration 0024)    |
| Une livraison appartient à un restaurant DJAFAT      | ❌ **absente**   | `Delivery` n'a aucune référence restaurant — le pickup vient d'`OrderAmountPort` |
| Un restaurant est toujours participant marketplace   | ⚠️ **implicite** | Toute commande naît d'un panier DJAFAT ; aucun champ ne consigne son origine     |
| `delivery fee` = totalité de la rémunération livreur | ⚠️ **en dur**    | `pricing.service.ts:46` — `const courierFee = deliveryFee;`                      |
| Lien direct commande → livreur                       | ❌ **supprimée** | `orders.courier_id` supprimé par la migration 0023 (Bloc 6)                      |
| `courier_id` sur `orders`                            | ❌ **supprimée** | Idem                                                                             |
| `delivery_id` sur `orders`                           | ❌ **absente**   | La clé étrangère vit sur `deliveries.order_id`, jamais l'inverse                 |
| Commission codée en dur                              | ❌ **absente**   | Résolue depuis `commission_rules` avec précédence de portée                      |

### 4.2 Une contrainte bloquante trouvée et corrigée

`PricingService.resolveCommissionBps` renvoie **0 bps** lorsqu'aucune règle ne
correspond. Or `buildOrderAccrualEntries` poussait la ligne `DJAFAT_REVENUE`
inconditionnellement, et `assertBalanced` refuse toute écriture d'un montant nul
(`NON_POSITIVE_AMOUNT`, [`packages/core/src/ledger/entry-group.ts`](../../packages/core/src/ledger/entry-group.ts)).

Conséquence vérifiée en exécutant le constructeur : une commande à 0 % de
commission produisait `DJAFAT_REVENUE credit 0` et **faisait échouer l'accrual
au moment du paiement**.

C'est exactement la forme comptable du modèle « DJAFAT Delivery seul »
(Decision E) : DJAFAT porte la course, facture la logistique, et ne prend aucune
part marketplace. Le modèle commercial que cet ADR déclare vouloir supporter
était donc littéralement impossible à enregistrer.

Corrigé par un garde d'une ligne, dans le style exact du garde déjà présent pour
les frais PSP. Le groupe reste équilibré : la commission n'a simplement jamais
quitté la part du restaurant. Trois tests le verrouillent.

### 4.3 Ce qui est déjà bien placé

- **Le ledger ne présume rien.** `ledger_accounts` est une table
  (`code`, `type`, `owner_type`, `owner_id`, `currency`), pas une énumération
  figée dans le code. Ajouter `DJAFAT_DELIVERY_REVENUE` et
  `DJAFAT_MARKETPLACE_REVENUE` est un `INSERT`, pas une migration de schéma.
- **`Delivery` ignore le restaurant.** Elle connaît une commande, un livreur,
  des coordonnées de pickup et de dropoff. Livrer pour un restaurant partenaire
  ne demande aucune modification du modèle de livraison.
- **Le DAG tient.** `deliveries` n'importe jamais `orders` : il passe par
  `OrderAmountPort`. Élargir le contexte de livraison est un changement de port,
  pas un couplage nouveau.
- **La commission est déjà des données.** Un restaurant en « Delivery seul » se
  représente par une `commission_rule` à 0 bps portée sur ce restaurant.

## 5. Business vision

DJAFAT démarre comme plateforme de livraison de repas et peut progressivement
contrôler davantage de la chaîne :

```
Production / Fournisseur → DJAFAT Supply → DJAFAT Inventory
                                                ↓
                                        DJAFAT Restaurant
                                                ↓
Restaurant partenaire ─────────────────────► Commande
                                                ↓
                                         DJAFAT Delivery
                                                ↓
                                             Client
```

Trois trajectoires coexistent, et aucune ne remplace les autres :

1. **DJAFAT bout en bout** — production, restaurant, commande, livraison.
2. **Partenaire + livraison DJAFAT** — le restaurant a déjà son client.
3. **Partenaire + marketplace + livraison DJAFAT** — DJAFAT apporte le client.

L'architecture doit pouvoir représenter les trois **simultanément**, pour des
restaurants différents, dans la même ville, le même jour.

## 6. Decision

### Decision A — DJAFAT possède progressivement son propre réseau logistique

Le réseau de livreurs est un **actif DJAFAT**, pas une commodité attachée à un
restaurant. Un livreur appartient à DJAFAT, pas à l'enseigne qu'il sert sur une
course donnée.

Conséquence déjà vraie dans le code : `couriers` est une table de premier rang
liée à `users`, jamais un champ sur `restaurants`.

### Decision B — DJAFAT peut livrer pour des restaurants qui ne sont pas les siens

Une livraison n'exige aucune appartenance du restaurant à DJAFAT.

Conséquence : **aucune modification nécessaire.** `Delivery` ne référence aucun
restaurant ; le point de retrait est une simple coordonnée résolue via
`OrderAmountPort`. Cette décision est déjà tenue par construction.

### Decision C — Un livreur pourra transporter plusieurs commandes compatibles

Le modèle cible :

```
Delivery #D100
  Courier: C42
  ├── Stop 1 → Order O100 (restaurant DJAFAT)     → Client A
  ├── Stop 2 → Order O101 (restaurant partenaire) → Client B
  └── Stop 3 → Order O102 (restaurant partenaire) → Client C
```

### Decision D — Le groupage n'est PAS implémenté

Le Bloc 6 reste un dispatch MVP : plus proche livreur éligible, rayon
configurable, disponibilité, verrouillage, accept/reject, retry, machine à
états. Aucune table `delivery_stops` n'est créée par cet ADR.

### Decision E — « DJAFAT Delivery » et « DJAFAT Marketplace » sont deux modèles distincts

|                         | **DJAFAT Delivery**  | **DJAFAT Marketplace**                                         |
| ----------------------- | -------------------- | -------------------------------------------------------------- |
| Qui apporte le client   | Le restaurant        | DJAFAT                                                         |
| Ce que DJAFAT fournit   | Logistique           | Découverte, catalogue, commande, paiement, support, logistique |
| Revenu DJAFAT           | Service de livraison | Commission marketplace **+** service de livraison              |
| Commission sur le repas | Non par défaut       | Selon les règles commerciales                                  |

**Les règles commerciales définitives ne sont pas décidées ici.** Cet ADR ne
fixe aucun taux, aucun barème, aucune politique de facturation.

### Decision F — Le modèle financier doit pouvoir séparer cinq flux

`restaurant payable` · `marketplace revenue` · `delivery revenue` ·
`courier compensation` · `PSP fees`.

**État actuel :** quatre des cinq sont déjà séparés. Seuls _marketplace revenue_
et _delivery revenue_ sont fondus dans un unique compte `DJAFAT_REVENUE`.

**Ce que cela coûtera de les séparer :** deux lignes dans `ledger_accounts` et
une modification du constructeur d'écritures. Pas de migration de schéma, pas de
réécriture du ledger. La séparation n'est pas faite maintenant parce qu'aucune
règle commerciale ne la rend encore nécessaire — et un compte qui n'est jamais
crédité différemment de son voisin est un compte qui ment sur sa raison d'être.

### Decision G — L'architecture reste ouverte à l'intégration verticale

`Supply → Inventory → Restaurant → Order → Delivery` doit rester représentable.

Aucune table n'est créée. La seule contrainte identifiée est consignée en §11.

### Decision H — Aucune architecture livestock n'est ajoutée

Pas d'élevage, pas de gestion animale, pas d'abattage, pas de traçabilité
sanitaire, pas de marketplace livestock. Ni maintenant, ni en anticipation.

## 7. Delivery architecture evolution

### 7.1 Où exactement le 1:1 est inscrit

La contrainte tient en **six points**, tous localisés :

| Emplacement                                                       | Nature                                    |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `Delivery.orderId @unique` (schema, migration `0010_orders`)      | La contrainte réelle                      |
| `deliveries.service.ts` — `findUnique({ where: { orderId } })` ×3 | Lectures qui supposent l'unicité          |
| `OrderDeliveryContext` (`packages/types/src/ports.ts`)            | Contexte à une seule commande             |
| `getByOrderIdOrThrow`, `getAssignedCourierUserIdByOrder`          | Résolveurs d'appartenance                 |
| `courier-accrual:<deliveryId>`                                    | Clé d'idempotence portée par la livraison |
| `delivery:<id>:funds_available`                                   | Idem                                      |

Ce n'est pas une hypothèse diffuse dans tout le code : c'est **une contrainte
d'unicité et cinq endroits qui en dépendent**. C'est la bonne nouvelle de cette
inspection.

### 7.2 Le chemin d'évolution

```
                V1 (aujourd'hui)              V2 (futur)
  Delivery ──1:1── Order          Delivery ──1:N── DeliveryStop ──1:1── Order
```

`DeliveryStop` porterait l'ordre de passage, le type (retrait ou dépôt), l'ETA,
et l'état du stop. `Delivery` deviendrait la **tournée** ; `DeliveryStop`
deviendrait ce que `Delivery` est aujourd'hui.

Migration additive : créer `delivery_stops`, y basculer les commandes
existantes une par une (chaque livraison V1 devient une tournée à un stop), puis
retirer la contrainte d'unicité. Aucune donnée détruite.

### 7.3 Les deux points qui demanderont une vraie réflexion

1. **Les clés d'idempotence.** `courier-accrual:<deliveryId>` devient ambiguë
   dès qu'une livraison porte trois commandes : trois reclassifications
   distinctes partageraient une clé. Elles devront être portées par le stop ou
   par la commande. C'est le point le plus dangereux de la transition V1→V2 —
   se tromper y signifie créer ou détruire de l'argent.

2. **La machine à états.** Les 10 états d'aujourd'hui décrivent une course. Une
   tournée a son propre cycle, et chaque stop le sien. Ce sont **deux machines**,
   pas une machine élargie — tenter d'exprimer les deux dans une seule table de
   transitions produirait exactement le genre d'état invalide que le Bloc 6.1 a
   passé sa matrice 10×10 à interdire.

### 7.4 Ce qui ne bougera pas

La room realtime `order:{id}` reste correcte sous le modèle multi-stop : elle
est déjà portée par la commande, pas par la livraison. L'autorisation serveur
écrite au Bloc 6.1 fonctionne telle quelle — un client suit sa commande, pas la
tournée du livreur, et ne doit d'ailleurs jamais voir les autres stops.

## 8. Commercial models

### 8.1 DJAFAT Delivery — le restaurant a déjà son client

```
Client ──commande directe──► Restaurant B ──prépare──► DJAFAT livre ──► Client
```

DJAFAT facture un service logistique. Pas de commission marketplace par défaut.

**Représentable aujourd'hui ?** Comptablement, **oui depuis la correction de
§4.2** : une `commission_rule` à 0 bps portée sur le restaurant.

**Ce qui manque encore :** rien ne consigne qu'une commande est arrivée par le
canal propre du restaurant plutôt que par le catalogue DJAFAT. Un futur champ
`orders.channel` (ou équivalent) le porterait. Non ajouté maintenant : aucune
règle ne s'en sert encore, et un champ que personne ne lit devient faux
silencieusement.

### 8.2 DJAFAT Marketplace — DJAFAT apporte le client

Le chemin déjà construit : découverte, catalogue, panier, commande, paiement,
livraison. Commission résolue par `commission_rules`.

### 8.3 Ce que cet ADR ne décide pas

Les taux, les barèmes, les minima, la facturation de la livraison au restaurant
plutôt qu'au client, les remises, le surge. Ce sont des décisions produit.

## 9. Financial implications

Le ledger reste **double-entry, immuable, écrivain unique**. Aucune de ces
propriétés n'est touchée.

### 9.1 Les trois flux cibles

**Restaurant DJAFAT** — le restaurant et la plateforme sont la même entité ;
`RESTAURANT_PAYABLE` devient une écriture interne, non une dette externe.

**Partenaire + DJAFAT Delivery**

```
Paiement client → PSP_CLEARING
                ├─► RESTAURANT_PAYABLE:<id>      (la totalité du repas)
                ├─► COURIER_FEE_POOL             (puis COURIER_PAYABLE:<id>)
                ├─► DJAFAT_DELIVERY_REVENUE      (le service logistique)
                └─► PSP_FEE_EXPENSE
```

**Partenaire + Marketplace + Delivery** — identique, plus
`DJAFAT_MARKETPLACE_REVENUE`.

### 9.2 Ce que cela demande

`ledger_accounts` porte `code`, `type`, `owner_type`, `owner_id`, `currency`.
Ajouter deux comptes de revenu est un `INSERT` avec `owner_type = 'djafat'`.
**Aucune migration de schéma.**

Le seul travail réel est de décider _où_ la scission s'opère dans
`buildOrderAccrualEntries` — et cela dépend des règles commerciales, pas de
l'architecture.

### 9.3 Le mécanisme du Bloc 6 tient tel quel

`COURIER_FEE_POOL` existe parce qu'au moment du paiement aucun livreur n'est
connu. Ce raisonnement est **indépendant du modèle commercial** : il tient
identiquement pour un restaurant DJAFAT, un partenaire, ou une tournée
multi-stop. Sous le modèle V2, chaque stop reclasserait sa propre part du pool —
le mécanisme ne change pas, seule la granularité de la clé change (§7.3).

## 10. Courier implications

### 10.1 L'invariant actuel, et pourquoi il est juste

« Un livreur = une livraison active », garanti par index unique partiel depuis
le Bloc 6.1. Sous V2 cet invariant **reste vrai** — un livreur conduit une
tournée à la fois. C'est la définition d'« active » qui s'élargit : elle
porterait sur la tournée, pas sur chaque commande.

C'est une propriété heureuse du choix fait au Bloc 6.1 : l'invariant a été posé
sur `deliveries`, qui est précisément l'entité destinée à devenir la tournée.

### 10.2 La rémunération

Aujourd'hui : `courierFee = deliveryFee` — décision A5.

Deux observations de l'inspection :

1. `platform_settings['courier_compensation_policy'] = {type:'delivery_fee'}` est
   bien semé, mais **aucun code ne le lit**. `pricing.service.ts:46` écrit
   directement `const courierFee = deliveryFee;`. L'indirection est fictive.
   Ce n'est pas un bug — la valeur est correcte — mais c'est un réglage qui
   ment sur son pouvoir. Documenté, non corrigé : le corriger aujourd'hui
   ajouterait une lecture de configuration sans aucun second cas à servir.

2. À terme, la rémunération pourrait dépendre du nombre de stops, de la
   distance réelle, de la zone, du temps, ou de règles commerciales. Le champ
   `deliveries.courier_fee_minor`, figé à l'assignation, reste le bon endroit
   pour porter le résultat de n'importe laquelle de ces règles. **Aucun nouveau
   moteur n'est construit ici.**

## 11. Vertical integration implications

### 11.1 La seule contrainte réelle trouvée

`ledger_accounts.owner_type` porte une contrainte `CHECK` sur une liste fermée :

```sql
owner_type text CHECK (owner_type IN ('djafat','psp','restaurant','courier','customer'))
```

Un fournisseur, un producteur ou un vendeur tiers devrait y être ajouté. C'est
une migration `ALTER … DROP CONSTRAINT … ADD CONSTRAINT` d'une ligne, sans perte
de données — le même geste que la migration 0025 vient d'exécuter sur une clé
étrangère. **Contrainte réelle, coût négligeable, aucune action maintenant.**

### 11.2 Ownership — décision de ne rien créer

Le §7 du mandat demande d'étudier un concept extensible (ownership, business
relationship, fulfillment mode, commercial model) plutôt qu'un
`restaurant.is_djafat = true`.

**Décision : ne rien ajouter maintenant.** Raisonnement :

- `Restaurant.ownerUserId` existe déjà et est nullable. Un restaurant DJAFAT
  est représentable sans nouveau champ.
- La distinction qui compte réellement aujourd'hui est **comptable**, et elle
  est déjà portée par les données : une `commission_rule` à 0 bps _est_ la
  relation « Delivery seul ».
- Une abstraction `business_relationship` créée avant d'avoir deux
  comportements réellement différents à piloter serait un champ que personne ne
  lit — et un champ que personne ne lit devient faux sans que rien n'échoue.

Le moment de créer cette abstraction est celui où une **deuxième** décision en
dépendra (facturation, SLA, ou visibilité catalogue). Pas avant.

L'anti-pattern à éviter explicitement reste `restaurant.is_djafat` : un booléen
qui ne sait exprimer ni « partenaire en marketplace », ni « partenaire en
livraison seule », ni « franchise », ni « dark kitchen opérée par un tiers ».

### 11.3 Produits et propriété

L'hypothèse « tout produit appartient au restaurant » est aujourd'hui vraie
(`Product.restaurantId` non nul). C'est correct pour un catalogue de repas.

Une chaîne `Supplier → Inventory → Restaurant` introduirait des entités dont le
restaurant n'est pas propriétaire. Cela se modélise le jour venu par des tables
propres, sans toucher `products` — un produit de menu resterait un produit de
menu. **Aucune action.**

## 12. What we implement now

| Élément                                             | Nature                                           |
| --------------------------------------------------- | ------------------------------------------------ |
| `docs/adr/0001-…md` (ce fichier)                    | Documentation                                    |
| Garde de commission nulle dans `accrual-entries.ts` | **Correction d'une contrainte bloquante** (§4.2) |
| 3 tests sur `accrual-entries.spec.ts`               | Verrouillage de cette correction                 |

Rien d'autre. Aucune migration, aucune table, aucun champ, aucun endpoint.

## 13. What we explicitly do NOT implement now

- Tables `delivery_stops` / tournées multi-commandes
- Moteur de groupage, d'optimisation de route, ou de dispatch intelligent
- Séparation `DJAFAT_MARKETPLACE_REVENUE` / `DJAFAT_DELIVERY_REVENUE`
- Abstraction `business_relationship` / `ownership` / `fulfillment_mode`
- Champ `orders.channel`
- Lecture effective de `courier_compensation_policy`
- Nouveau moteur de rémunération livreur
- Inventory, Supply, marketplace élargie
- Toute structure livestock (Decision H)

## 14. Future evolution

| Palier | Contenu                                                                  | Prérequis                                                                       |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **V1** | 1 commande → 1 livraison                                                 | ✅ livré (Blocs 6 / 6.1)                                                        |
| **V2** | 1 livreur → plusieurs commandes compatibles                              | `delivery_stops` ; clés d'idempotence par stop (§7.3) ; seconde machine à états |
| **V3** | Optimisation dynamique de tournée                                        | V2 ; ETA fiables ; distances réelles                                            |
| **V4** | Dispatch intelligent (ETA, géographie, préparation, capacité, SLA, coût) | V3 ; données historiques                                                        |

### 14.1 Le groupage n'est jamais automatiquement bon

Un moteur de groupage doit pouvoir **refuser**. Les critères d'un refus :

- dégradation de l'ETA d'une commande déjà promise ;
- sécurité alimentaire — température, temps de transport ;
- capacité du sac ;
- incompatibilité de direction ;
- SLA client ;
- temps de préparation non aligné.

L'exemple canonique : si ajouter la commande B allonge la commande A de
25 minutes, le moteur doit refuser — **même si le regroupement est rentable**.
La qualité de livraison prime sur le taux d'utilisation du réseau.

Cette règle est consignée ici pour que le futur moteur soit conçu avec le refus
comme cas de première classe, et non comme exception.

## 15. Alternatives considered

| Alternative                                           | Écartée parce que                                                                                                                                                                   |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Créer `delivery_stops` maintenant                     | Une table vide n'enseigne rien et se révèle presque toujours mal dimensionnée le jour où elle sert. Le 1:1 tient en six points recensés — le coût de l'attente est connu et faible. |
| `restaurant.is_djafat boolean`                        | Mauvaise abstraction : ne distingue pas partenaire-marketplace, partenaire-livraison-seule, franchise, ou dark kitchen. Explicitement rejetée par le mandat §7.                     |
| Table `business_relationships` maintenant             | Aucun second comportement à piloter aujourd'hui. Le premier lecteur serait un test.                                                                                                 |
| Scinder `DJAFAT_REVENUE` maintenant                   | Deux comptes crédités selon la même règle ne sont pas deux comptes. Le coût de la scission est de deux `INSERT` le jour où les règles divergent.                                    |
| Rendre `courier_compensation_policy` effectivement lu | Ajouterait une lecture de configuration avec un seul cas à servir. La valeur actuelle est correcte ; l'écart est documenté (§10.2).                                                 |
| Sur-généraliser en « logistique universelle »         | Contredit le §16 du mandat. « Design for evolution, not for implementation of every future idea. »                                                                                  |

## 16. Risks

| Risque                                                                    | Gravité                                               | Atténuation                                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Les clés d'idempotence portées par la livraison deviennent ambiguës en V2 | **Élevée** — se tromper y crée ou détruit de l'argent | Recensé §7.3 ; l'audit ledger du Bloc 6.1 fournit le harnais (grand livre complet) pour valider la transition   |
| Le 1:1 se propage dans du code Bloc 7+                                    | Moyenne                                               | Les six points sont recensés §7.1 ; toute nouvelle lecture `findUnique({orderId})` doit être un choix conscient |
| Un modèle commercial arrive avant l'abstraction qui le porte              | Moyenne                                               | Le levier comptable (commission 0 bps) couvre le cas immédiat ; le champ `channel` reste disponible             |
| Étendre `owner_type` oublié lors d'un travail Supply                      | Faible                                                | Consigné §11.1 ; migration d'une ligne                                                                          |
| Un futur groupage dégrade l'expérience client                             | **Élevée** commercialement                            | §14.1 : le refus doit être un cas de première classe                                                            |
| Les migrations 0024/0025 n'ont jamais tourné sur un vrai PostgreSQL       | Moyenne                                               | Dette du Bloc 6.1, inchangée par cet ADR — Docker indisponible                                                  |

## 17. Consequences

**Positives**

- La trajectoire V1→V4 est écrite, et le coût de chaque palier est chiffré en
  points de code précis plutôt qu'en intuition.
- Le modèle « DJAFAT Delivery seul » est passé d'impossible à enregistrer
  (500 au paiement) à fonctionnel, pour une ligne de code.
- Trois décisions de _ne pas_ construire sont motivées et datées, ce qui les
  rend révisables plutôt que oubliées.
- Aucun engagement pris sur des règles commerciales qui n'existent pas encore.

**Négatives, assumées**

- Le 1:1 `Delivery ↔ Order` reste. V2 demandera une migration et une réflexion
  sérieuse sur les clés d'idempotence.
- `DJAFAT_REVENUE` reste un compte unique : aucun reporting ne peut aujourd'hui
  distinguer revenu marketplace et revenu logistique.
- `courier_compensation_policy` reste un réglage sans effet.
- L'origine d'une commande n'est pas enregistrée.

**Neutres**

- Aucun invariant des Blocs 0 à 6.1 n'est touché.

## 18. Open questions

1. **Qui paie la livraison dans le modèle « DJAFAT Delivery » ?** Le client à la
   commande, ou le restaurant sur facture périodique ? La réponse change la
   forme des écritures, pas l'architecture.
2. **Le groupage est-il rémunéré au livreur par stop, par tournée, ou au
   temps ?** Bloque V2, pas V1.
3. **Un restaurant partenaire peut-il refuser la livraison groupée ?** Question
   contractuelle avant d'être technique.
4. **`orders.channel` ou une relation commerciale portée par le restaurant ?**
   Tranchable au premier vrai besoin, pas avant.
5. **Où s'arrête l'intégration verticale ?** Détermine si `Supply`/`Inventory`
   deviennent des modules DJAFAT ou des intégrations tierces.
6. **Une tournée peut-elle servir deux villes ?** Touche le partitionnement
   `country`/`city` (AD-05).

---

## Cohérence avec les blocs existants

Vérifié contre les Blocs 0, 0.5, 1, 2, 3, 4, 5, 6 et 6.1.

| Décision / mécanisme                            | État                                                        |
| ----------------------------------------------- | ----------------------------------------------------------- |
| A1–A9 (décisions verrouillées)                  | Inchangées. A5 documentée §10.2, non modifiée               |
| AD-01 `Money`                                   | Inchangé                                                    |
| AD-02 ledger écrivain unique                    | Inchangé                                                    |
| AD-03 abstraction provider de paiement          | Inchangée                                                   |
| AD-06 commission résolue + snapshotée           | Inchangée ; §4.2 corrige uniquement le cas 0 bps            |
| AD-09 DAG + `OrderAmountPort`                   | Inchangé                                                    |
| Machine à états de livraison                    | Inchangée                                                   |
| `COURIER_FEE_POOL`                              | Inchangé ; raisonnement confirmé indépendant du modèle §9.3 |
| Autorisation realtime                           | Inchangée ; reste correcte en V2 §7.4                       |
| Outbox, idempotence                             | Inchangés ; granularité des clés recensée §7.3              |
| Invariant « un livreur = une livraison active » | Inchangé ; reste vrai en V2 §10.1                           |

La seule modification de code est le garde de commission nulle (§4.2) : un
`if` dans un constructeur d'écritures pur, du même modèle que le garde voisin
sur les frais PSP, couvert par trois tests.
