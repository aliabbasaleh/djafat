# 09 — Livraison, géolocalisation, temps réel & notifications

## PARTIE A — LIVRAISON & DISPATCH

### A.1 Cycle de vie

```text
order.confirmed (delivery)
   -> delivery 'created'
   -> 'searching_courier'   (job dispatch)
   -> 'offered'             (offres envoyées à N livreurs)
   -> 'assigned'            (un livreur accepte ; les autres offres -> 'expired')
   -> 'arrived_at_restaurant'
   -> 'picked_up'
   -> 'on_the_way'
   -> 'arrived_at_customer'
   -> 'delivered'           (preuve : photo + code client)
   [échecs] -> 'failed' (client injoignable, refus...) / 'cancelled'
```

### A.2 Dispatch — MVP (« plus proche disponible »)

```text
Déclencheur : payment.succeeded (ou cash) & fulfillment='delivery'
1. Candidats = couriers WHERE is_online AND status='approved' AND active_delivery_id IS NULL
   AND ST_DWithin(last_geom, pickup_geom, RAYON)         -- RAYON = 3 km, élargi par paliers
   AND last_location_at > now() - interval '2 minutes'
2. Trier par distance (ST_Distance). Prendre les K premiers (K=1 en vague, ou K=3 en parallèle court).
3. Créer delivery_offers (expires_at = now()+30 s), push WS courier.offer.new + notif.
4. Acceptation (POST /courier/offers/:id/accept, idempotent) :
     transaction : SELECT ... FOR UPDATE sur delivery ; si status encore 'offered' :
        delivery.courier_id = courier ; status='assigned' ; courier.active_delivery_id = delivery
        autres offers -> 'expired' ; WS courier.offer.expired aux autres
     sinon -> 409 OFFER_TAKEN
5. Aucune acceptation avant expiration -> vague suivante (RAYON+2 km, ou K suivants).
6. Après P vagues sans preneur -> ops.alert admin + option réassignation manuelle / bascule pickup.
```

### A.3 Dispatch — évolution (V2, derrière la même interface `DispatchStrategy`)

Score par livreur = pondération de : distance/ETA réel (RoutingProvider) · charge (courses récentes) · taux d'acceptation & note · ancienneté d'attente · adéquation véhicule (moto vs vélo selon distance) · zone préférée · équité de distribution des revenus. Batching (assigner plusieurs commandes proches d'un même resto). File d'attente resto → livreur pré-positionné.

### A.4 Rémunération livreur (décision A5)

**Règle par défaut verrouillée : `courier compensation = delivery fee`.** La rémunération est **configurable** via `platform_settings['courier_compensation_policy']` — au MVP `{ "type": "delivery_fee" }`. L'architecture ne bloque **aucune** évolution : `type` pourra devenir `fixed` | `percent` | `distance` | `zone` | `surge` | `hybrid`, avec des paramètres par ville — sans changement de schéma (juste la fonction de résolution dans `pricing`).

`deliveries.courier_fee_minor` (+ `currency`) est **calculée par `pricing`** au moment de la création de la livraison et **figée à l'assignation du livreur** (elle apparaît telle quelle dans l'offre → `fee: Money`). Elle est créditée au compte `COURIER_PAYABLE:<id>` du grand livre à `delivered` **via `LedgerPort`** (jamais d'écriture directe dans un wallet), puis libérée sur `COURIER_AVAILABLE` selon `funds_release_policy` (A3).

> Post-audit : le module `deliveries` **n'écrit jamais** dans le grand livre ni dans un wallet ; il appelle `LedgerService.postEntryGroup(...)`. Voir `docs/15-audit-corrections.md` (AD-02, A3, A5).

### A.5 Preuve de livraison

`delivery_proofs` : photo (S3) **et/ou** code à 4 chiffres remis au client (dans l'app client + SMS de secours) que le livreur saisit. `delivered` refusé sans au moins un des deux (paramétrable par zone). Litige → `failed` + ticket support + gel du paiement cash concerné.

### A.6 Machine à états & garde-fous

- Transitions définies dans `@djafat/core` ; contrôle de portée (le livreur n'agit que sur SA `delivery`).
- `couriers.active_delivery_id` garantit 1 course active/livreur (MVP).
- Passer `offline` avec une course active : bloqué (finir ou annuler explicitement → réassignation).
- Perte réseau livreur : les actions (`picked_up`, `delivered`) sont mises en file locale avec `Idempotency-Key`, rejouées à la reconnexion ; l'état serveur tranche.

---

## PARTIE B — GÉOLOCALISATION

### B.1 Réalité N'Djamena

Adressage rue/numéro peu fiable, couverture OSM partielle. → **le point de repère et les instructions sont des champs de premier plan**, pas des options. Une adresse valide = (repère + quartier + téléphone) au minimum ; lat/lng est un **plus** (GPS ou sélection carte), pas un prérequis.

### B.2 Modèle (rappel doc 06 `addresses`)

`quartier`, `street`, `landmark` (repère), `instructions`, `recipient_phone`, `geom` (nullable), `geocode_status` (`pending|ok|failed|manual`).

### B.3 Saisie d'adresse — modes proposés au client

1. **GPS** : « Utiliser ma position » → capture lat/lng + reverse-geocode best-effort pour pré-remplir quartier.
2. **Carte** : déplacer un pin sur MapLibre (tuiles OSM), utile en tablette/desktop.
3. **Repère** : champ libre + suggestions (POIs connus : stations, marchés, ronds-points, écoles… base `landmarks` alimentée progressivement).
4. **Manuel** : quartier + description libre + téléphone, sans coordonnées → `geocode_status='manual'`, le livreur appelle.

Un job `geocoding` tente d'attribuer des coordonnées aux adresses `pending` (repère + quartier → provider) ; échec → `failed`, l'adresse reste utilisable.

### B.4 Abstractions

```ts
interface MapProvider {
  /* rendu carte, tuiles, style */
}
interface GeocodingProvider {
  forward(q, bias?): GeoResult[];
  reverse(lat, lng): GeoResult;
}
interface RoutingProvider {
  route(from, to): { distanceM; durationS; polyline };
}
```

- **Défaut** : MapLibre + OSM (tuiles hébergées) ; géocodage Nominatim auto-hébergé + base `landmarks` maison ; routing OSRM/Valhalla auto-hébergé **ou** estimation simple (distance haversine × facteur détour 1.4 + vitesse moyenne moto) au tout début.
- **Sélectif** : brancher Google/Mapbox pour l'ETA livreur en temps réel si la qualité OSRM locale est insuffisante — sans changer une ligne de métier.
- Cache Redis des résultats de géocodage/routing (clé = requête normalisée, TTL long).

### B.5 Ingestion position livreur

`POST /v1/courier/location` (batch de points accepté). Contraintes : throttle 5–10 s côté app, envoi **uniquement** si `online` ou course active, compression, arrêt total offline. Stockage `delivery_locations` (partition/jour, rétention 30 j) + mise à jour `couriers.last_geom`. Diffusion WS `courier.location` throttlée vers `order:{id}` (jamais la position exacte hors course pour le client).

---

## PARTIE C — TEMPS RÉEL

### C.1 Infra

Socket.IO, namespace `/rt`, **adaptateur Redis** (scale horizontal), auth JWT à la connexion, heartbeat, reconnexion auto, **fallback long-polling** activé (réseau instable). Les événements proviennent de l'**outbox** (garantie « pas d'événement fantôme »).

### C.2 Rooms & autorisation

| Room                | Qui peut s'abonner                                               | Reçoit                                                               |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `order:{id}`        | client propriétaire, restaurant concerné, livreur assigné, admin | `order.status`, `delivery.status`, `courier.location`, `order.eta`   |
| `customer:{userId}` | l'utilisateur                                                    | notifications in-app, `order.status` de toutes ses commandes actives |
| `restaurant:{id}`   | staff du resto                                                   | `restaurant.order.new`, `order.updated`                              |
| `courier:{id}`      | le livreur                                                       | `courier.offer.new`, `courier.offer.expired`, `delivery.status`      |
| `admin:ops`         | admin                                                            | `ops.alert`                                                          |

Toute demande `subscribe` passe par un contrôle d'accès serveur (pas de room « devinable »).

### C.3 Économie de bande passante

- Payloads minimalistes (pas d'objet commande complet dans un event ; juste `{orderId, status, at, etaMinutes}` → le client refetch si besoin).
- `courier.location` : throttle 5–10 s, arrondi des coordonnées, arrêt quand l'app est en arrière-plan (le suivi reprend au premier plan).
- Le client se désabonne des rooms de commandes terminées.

### C.4 Fallback

Si le socket ne se connecte pas en ~8 s ou tombe : bascule sur polling `GET /v1/orders/:id/tracking` (10–20 s, plus lent en arrière-plan). Bandeau « connexion instable » discret.

---

## PARTIE D — NOTIFICATIONS

### D.1 Principe

Un **événement de domaine** → le module `notifications` décide des canaux selon `type` + `notification_preferences` + criticité + plateforme. Backend unique, rendus multiples.

```text
Event (order.confirmed) ─► NotificationService
     ├─ résout destinataires + préférences + langue
     ├─ choisit canaux : push (si device), in_app (toujours), sms (si critique & pas de push/échec)
     ├─ rend le template (i18n)
     └─ enfile jobs BullMQ par canal (retries + backoff + dead-letter)
```

### D.2 Canaux

| Canal  | Techno                                 | Usage                                                             |
| ------ | -------------------------------------- | ----------------------------------------------------------------- |
| Push   | Expo Push → FCM/APNs                   | mises à jour commande, offre livreur, promos (opt-in)             |
| In-app | WS + table `notifications` + badge     | tout, historique consultable                                      |
| SMS    | abstraction `SmsProvider` (agrégateur) | événements critiques si push indisponible/échoué, client sans app |
| Email  | abstraction `EmailProvider`            | reçus, résumés restaurant, réinitialisations (secondaire)         |

> **OTP (décision A9)** : la remise de l'OTP passe par un port dédié `OtpDeliveryPort` (distinct du système de notifications), impl `sms` au MVP (via `SmsProvider`), extensible à `whatsapp` / `email` sans toucher `auth`. Canaux actifs : `platform_settings['otp_channels']` = `["sms"]`.

### D.3 Matrice événement → canal (extrait)

| Événement                  | Client                         | Restaurant            | Livreur                         |
| -------------------------- | ------------------------------ | --------------------- | ------------------------------- |
| OTP                        | SMS                            | —                     | —                               |
| order.placed               | in-app + push                  | push + WS + son       | —                               |
| payment.succeeded          | in-app + push                  | push (« à préparer ») | —                               |
| order.confirmed / rejected | push + in-app (+ SMS si rejet) | —                     | —                               |
| courier.offer              | —                              | —                     | push + WS (son, priorité haute) |
| courier_assigned           | push + in-app                  | in-app                | —                               |
| picked_up / on_the_way     | push + in-app                  | —                     | —                               |
| delivered                  | push + in-app + (SMS reçu)     | in-app                | in-app (gains)                  |
| order.cancelled            | push + in-app (+ SMS)          | push                  | push (si assigné)               |

### D.4 Robustesse & coût

- **Déduplication** : clé `(user_id, type, order_id)` → pas de spam si l'événement est réémis.
- **SMS = coût réel** : réservé au critique et à l'absence de push ; compteur + plafond par commande ; monitoring du coût SMS/jour.
- **Android OEM** : push via FCM haute priorité pour l'offre livreur ; foreground service pendant une course garantit la réception.
- **Préférences** : le client peut couper le marketing, jamais les notifications transactionnelles.
- Enregistrement device : `POST /v1/me/devices { platform, pushToken }` ; token invalide (retour Expo) → purge.
