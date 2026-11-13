# Caddy (automatic HTTPS) + the courier app built for the web (static files).
FROM node:22-bookworm-slim AS courier
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo
ARG EXPO_PUBLIC_API_BASE_URL
ENV EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL
COPY . .
RUN pnpm install --frozen-lockfile --filter "@djafat/courier..." \
 && pnpm --filter "@djafat/courier^..." run build \
 && pnpm --filter "@djafat/courier" run build:web

FROM caddy:2.8.4-alpine
COPY --from=courier /repo/apps/courier/dist-web /srv/courier
COPY infra/deploy/Caddyfile /etc/caddy/Caddyfile
