# Multi-stage build for @djafat/api. Portable (decision A6) — no cloud coupling.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages ./packages
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker/package.json ./apps/worker/package.json
RUN pnpm install --frozen-lockfile --filter "@djafat/api..." --filter "@djafat/worker..."

FROM deps AS build
COPY . .
RUN pnpm --filter "@djafat/api^..." run build \
 && pnpm --filter "@djafat/api" run db:generate \
 && pnpm --filter "@djafat/api" run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build /repo/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3001
USER node
CMD ["node", "apps/api/dist/main.js"]
