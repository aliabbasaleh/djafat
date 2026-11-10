#!/usr/bin/env bash
# DJAFAT — installation on a fresh Ubuntu 22.04/24.04 server (Oracle Cloud
# "Always Free" Ampere, Hetzner, OVH…). Run from the cloned repository:
#
#   DOMAIN=djafat.com ACME_EMAIL=contact@djafat.com MODE=demo ./infra/deploy/install.sh
#
# Idempotent: re-running it updates the code and restarts the stack, and never
# regenerates the secrets of an existing installation.
set -euo pipefail
cd "$(dirname "$0")"
DEPLOY_DIR=$(pwd)
REPO_DIR=$(cd ../.. && pwd)
MODE="${MODE:-demo}"
say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

say "1/5 Paquets système et Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="sudo docker"

say "2/5 Pare-feu du serveur : ports 80 et 443 ouverts"
# Oracle's Ubuntu images ship an iptables REJECT rule: web ports must be
# allowed before it (the Oracle "Security List" must allow them too).
if command -v iptables >/dev/null 2>&1; then
  for port in 80 443; do
    sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
      || sudo iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
  done
  if command -v netfilter-persistent >/dev/null 2>&1; then sudo netfilter-persistent save; fi
fi

say "3/5 Code à jour"
git -C "$REPO_DIR" pull --ff-only || echo "(pas de mise à jour du code — on continue)"

say "4/5 Clés secrètes (créées une seule fois, gardées sur ce serveur)"
if [ ! -f .env.prod ]; then
  : "${DOMAIN:?Indiquez DOMAIN=djafat.com}"
  : "${ACME_EMAIL:?Indiquez ACME_EMAIL=votre@email}"
  DOMAIN="$DOMAIN" ACME_EMAIL="$ACME_EMAIL" MODE="$MODE" ./gen-secrets.sh
else
  echo ".env.prod existe déjà — clés conservées."
fi
mkdir -p backups

say "5/5 Construction et démarrage (10 à 20 minutes la première fois)"
PROFILE=()
grep -q '^SEED_DEMO=1' .env.prod && PROFILE=(--profile demo)
$DOCKER compose --env-file .env.prod -f docker-compose.prod.yml "${PROFILE[@]}" up -d --build

say "État des services"
$DOCKER compose --env-file .env.prod -f docker-compose.prod.yml "${PROFILE[@]}" ps
DOMAIN_SET=$(grep '^DOMAIN=' .env.prod | cut -d= -f2)
cat <<EOF

DJAFAT démarre. Dans quelques minutes (le temps des certificats HTTPS) :
  https://$DOMAIN_SET          site client
  https://admin.$DOMAIN_SET    administration
  https://resto.$DOMAIN_SET    restaurants
  https://livreur.$DOMAIN_SET  app livreur
  https://api.$DOMAIN_SET/v1/health

Les adresses doivent déjà pointer vers ce serveur chez Namecheap.
Journaux : cd $DEPLOY_DIR && $DOCKER compose --env-file .env.prod -f docker-compose.prod.yml logs -f
EOF
