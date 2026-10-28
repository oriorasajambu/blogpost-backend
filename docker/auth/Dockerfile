FROM node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
WORKDIR /emulator
RUN mkdir -p /emulator/data && chown node:node /emulator /emulator/data
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,id=blogpost-npm,target=/home/node/.npm,uid=1000,gid=1000,sharing=locked npm ci --omit=dev --no-audit
COPY --chown=node:node firebase.json start.mjs ./
EXPOSE 9099
ENTRYPOINT ["node", "start.mjs"]
