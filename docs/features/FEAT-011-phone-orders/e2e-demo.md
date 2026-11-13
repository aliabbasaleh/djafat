# FEAT-011 — Démonstration réelle (2026-11-09)

Environnement local : PostgreSQL + Redis, API compilée, worker, admin Next.js
(`/admin/phone-order`), base remise à zéro. Restaurant de démo ouvert 24 h/24
(démonstration seulement).

1. Connexion à l'admin avec le compte `support` (+23566000005) : l'admin
   l'emmène directement sur « Commande par téléphone » ; le menu ne montre que
   ses deux écrans.
2. Numéro 66 77 78 88 (inconnu), nom « Achta Mahamat », Chez Fatimé :
   1 poulet braisé (portion Entier), 2 frites ; quartier Moursal, repère
   « derrière la grande mosquée, portail bleu ». « Envoyer la commande ».
3. Écran « Commande envoyée » : DJF-B804AA169B, 6 500 FCFA, payée à la
   livraison, « nouveau client ».
4. Contrôles en base : commande `placed` puis suivie par le restaurant et le
   livreur jusqu'à `on_the_way` ; client +23566777888 créé avec son nom ;
   lignes 1 × 3 500 + 2 × 1 000 ; paiement `cash` en attente (réglé à la
   livraison) ; audit `ORDER_PLACED_BY_PHONE` avec le standardiste
   +23566000005.

Vidéo : `apercu/demo-commande-telephone.mp4` (non versionnée).
