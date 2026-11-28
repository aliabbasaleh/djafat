# Next.js front (web | admin | restaurant) for the production stack.
# The API URL is baked in at build time (NEXT_PUBLIC_*), so it is a build arg.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_DJAFAT_ORDER_NUMBER=""
ARG NEXT_PUBLIC_DJAFAT_CALL_NUMBER=""
ENV NEXT_TELEMETRY_DISABLED=1 \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_DJAFAT_ORDER_NUMBER=$NEXT_PUBLIC_DJAFAT_ORDER_NUMBER \
    NEXT_PUBLIC_DJAFAT_CALL_NUMBER=$NEXT_PUBLIC_DJAFAT_CALL_NUMBER
COPY . .
RUN pnpm install --frozen-lockfile --filter "@djafat/${APP}..." \
 && pnpm --filter "@djafat/${APP}^..." run build \
 && pnpm --filter "@djafat/${APP}" run build

FROM base AS runtime
ARG APP
# `next start` reads next.config.mjs again: the site's image server allows the
# API's own host (uploaded photos, FEAT-022) from this variable, so it must be
# the same here as in the build stage.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APP=${APP} \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
WORKDIR /repo
COPY --from=build /repo /repo
USER node
WORKDIR /repo/apps/${APP}
CMD ["sh", "-c", "node_modules/.bin/next start -p 3000 -H 0.0.0.0"]
