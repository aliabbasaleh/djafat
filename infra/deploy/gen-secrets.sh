#!/usr/bin/env bash
# Writes infra/deploy/.env.prod with fresh random secrets. Run ONCE, on the
# server; never commit the result (it is gitignored). Re-running refuses to
# overwrite an existing file (rotating keys would lock everyone out).
#
#   DOMAIN=djafat.com ACME_EMAIL=you@example.com MODE=demo ./gen-secrets.sh
#
# MODE=demo : login codes go to the internal test inbox (mock-sms), demo data
#             is seeded. For showing the product, never for real customers.
# MODE=live : you must then fill in the real SMS provider (SMS_HTTP_URL,
#             SMS_HTTP_API_KEY) and the real Airtel merchant number.
set -euo pipefail
cd "$(dirname "$0")"
OUT=.env.prod
if [ -e "$OUT" ]; then echo "$OUT already exists — not overwriting." >&2; exit 1; fi
: "${DOMAIN:?DOMAIN=djafat.com}"
: "${ACME_EMAIL:?ACME_EMAIL=address for the HTTPS certificates}"
MODE="${MODE:-demo}"
case "$MODE" in demo|live) ;; *) echo "MODE must be demo or live" >&2; exit 1;; esac

hex() { openssl rand -hex 32; }
b64() { openssl rand -base64 32; }
PG=$(openssl rand -hex 24)
S3_KEY=djafat$(openssl rand -hex 6)
S3_SECRET=$(openssl rand -hex 24)

# PostGIS has no official ARM image: on an ARM server (e.g. Oracle Cloud
# "Always Free" Ampere) use the community multi-arch build.
case "$(uname -m)" in
  aarch64|arm64) POSTGIS_IMAGE=imresamu/postgis:16-3.5 ;;
  *) POSTGIS_IMAGE=postgis/postgis:16-3.5 ;;
esac

umask 077
cat > "$OUT" <<ENV
# Generated $(date -u +%FT%TZ) — mode $MODE. Keep this file secret.
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
POSTGIS_IMAGE=$POSTGIS_IMAGE
SEED_DEMO=$([ "$MODE" = demo ] && echo 1 || echo 0)
NODE_ENV=production
LOG_LEVEL=info

POSTGRES_PASSWORD=$PG
DATABASE_URL=postgresql://djafat:$PG@postgres:5432/djafat?schema=public
DIRECT_DATABASE_URL=postgresql://djafat:$PG@postgres:5432/djafat?schema=public
REDIS_URL=redis://redis:6379

OBJECT_STORAGE_ENDPOINT=http://minio:9000
OBJECT_STORAGE_REGION=fr-par
OBJECT_STORAGE_BUCKET=djafat
OBJECT_STORAGE_ACCESS_KEY_ID=$S3_KEY
OBJECT_STORAGE_SECRET_ACCESS_KEY=$S3_SECRET
OBJECT_STORAGE_FORCE_PATH_STYLE=true

API_HOST=0.0.0.0
API_PORT=3001
API_PUBLIC_URL=https://api.$DOMAIN
API_CORS_ORIGINS=https://$DOMAIN,https://www.$DOMAIN,https://admin.$DOMAIN,https://resto.$DOMAIN,https://livreur.$DOMAIN
PAYMENT_WEBHOOK_BASE_URL=https://api.$DOMAIN/v1/payments/webhook

JWT_ACCESS_SECRET=$(hex)
REFRESH_TOKEN_HASH_SECRET=$(hex)
OTP_HASH_SECRET=$(hex)
MFA_ENCRYPTION_KEY=$(b64)
DELIVERY_CODE_ENCRYPTION_KEY=$(b64)
SMS_GATEWAY_ENCRYPTION_KEY=$(b64)

OTP_CHANNELS=sms
SMS_PROVIDER=http
SMS_HTTP_URL=$([ "$MODE" = demo ] && echo "http://mock-sms:4020/send" || echo "REPLACE_WITH_SMS_PROVIDER_URL")
SMS_HTTP_API_KEY=
EMAIL_PROVIDER=mock
WHATSAPP_PROVIDER=mock

# Merchant wallets customers pay to (FEAT-009). DEMO: fictitious number.
MOBILE_MONEY_WALLETS=airtel_money=$([ "$MODE" = demo ] && echo "+23560000010" || echo "REPLACE_WITH_AIRTEL_MERCHANT_NUMBER")

# Shown on the site for orders without data (FEAT-017).
DJAFAT_ORDER_NUMBER=+23566868973
DJAFAT_CALL_NUMBER=+23530109090

# Server alerts (healthcheck.sh, docs/38): an ntfy.sh topic only the team knows,
# e.g. https://ntfy.sh/djafat-ops-<long random suffix>. Empty = log only.
ALERT_NTFY_URL=
ENV
echo "Wrote $OUT (mode $MODE). Next: docker compose --env-file .env.prod -f docker-compose.prod.yml $([ "$MODE" = demo ] && echo '--profile demo ')up -d --build"
