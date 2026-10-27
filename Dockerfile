FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data/media && chown node:node /app /data/media

FROM base AS dependencies
COPY --chown=node:node package.json package-lock.json ./
USER node
# Keep Prisma's download cache outside image layers, just like npm's cache.
RUN --mount=type=cache,id=blogpost-npm,target=/home/node/.npm,uid=1000,gid=1000,sharing=locked --mount=type=cache,id=blogpost-prisma,target=/home/node/.cache/prisma,uid=1000,gid=1000,sharing=locked npm ci --no-audit

FROM dependencies AS sources
ENV NODE_ENV=development
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node prisma.config.ts tsconfig.json tsconfig.build.json ./
RUN --mount=type=cache,id=blogpost-prisma,target=/home/node/.cache/prisma,uid=1000,gid=1000,sharing=locked npm run db:generate
COPY --chown=node:node .prettierrc.json .prettierignore ./
COPY --chown=node:node src ./src
COPY --chown=node:node config ./config
COPY --chown=node:node test ./test
COPY --chown=node:node contracts ./contracts
COPY --chown=node:node mock ./mock
COPY --chown=node:node tools/mock ./tools/mock
COPY --chown=node:node scripts/dev/mock.mjs ./scripts/dev/mock.mjs
COPY --chown=node:node scripts/build ./scripts/build
COPY --chown=node:node scripts/deploy ./scripts/deploy

FROM sources AS development
USER root
RUN mkdir -p /app/.build && chmod 0555 /app/.build
COPY --from=blogpost_metadata --chown=root:root --chmod=0444 /provenance.json /app/.build/provenance.json
USER node
EXPOSE 8080
CMD ["npm", "run", "start:dev"]

FROM sources AS build
ENV NODE_ENV=test
RUN node scripts/build/test-metadata.mjs && npm run typecheck && npm test && npm run test:deploy && npm run build

FROM base AS production-dependencies
COPY --chown=node:node package.json package-lock.json ./
USER node
# npm retains optional Prisma CLI/TypeScript peers despite their dev declarations.
# Uninstall the CLI tree and remove the optional compiler; keep native runtime packages.
RUN --mount=type=cache,id=blogpost-npm,target=/home/node/.npm,uid=1000,gid=1000,sharing=locked --mount=type=cache,id=blogpost-prisma,target=/home/node/.cache/prisma,uid=1000,gid=1000,sharing=locked \
    npm ci --omit=dev --no-audit \
    && npm uninstall --no-save --omit=dev --ignore-scripts --no-audit prisma \
    && node -e "require('node:fs').rmSync('/app/node_modules/typescript', { recursive: true, force: true })" \
    && rm -f /app/node_modules/.bin/tsc /app/node_modules/.bin/tsserver \
    && test ! -d node_modules/prisma && test ! -d node_modules/typescript

FROM base AS operations-dependencies
RUN mkdir -p /opt/prisma && chown node:node /opt/prisma
WORKDIR /opt/prisma
COPY --chown=node:node docker/operations/package.json docker/operations/package-lock.json ./
USER node
RUN --mount=type=cache,id=blogpost-npm,target=/home/node/.npm,uid=1000,gid=1000,sharing=locked --mount=type=cache,id=blogpost-prisma,target=/home/node/.cache/prisma,uid=1000,gid=1000,sharing=locked npm ci --omit=dev --no-audit

FROM base AS runtime
ENV NODE_ENV=production
RUN mkdir -p /app/.build && chown root:root /app /app/.build && chmod 0755 /app && chmod 0555 /app/.build
COPY --from=blogpost_metadata --chown=root:root --chmod=0444 /provenance.json /app/.build/provenance.json
USER node
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=root:root package.json ./
COPY --from=build --chown=node:node /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/main.js"]

# Migration tooling is used by short-lived jobs, not by the API service.
FROM runtime AS operations
COPY --chown=root:root config/database/schema-baseline.json ./config/database/schema-baseline.json
COPY --from=operations-dependencies --chown=node:node /opt/prisma ./operations-tooling
RUN ln -sT /app/operations-tooling/node_modules/prisma /app/node_modules/prisma
COPY --from=build --chown=root:root /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts
CMD ["node", "dist/ops/verify-db.js"]
