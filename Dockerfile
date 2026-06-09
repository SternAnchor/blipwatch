# syntax=docker/dockerfile:1

ARG NODE_VERSION=22.21.1

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV HEADLESS=true \
    IMAGE_SIZE=1024 \
    LOG_LEVEL=info \
    NODE_ENV=production \
    PORT=8080 \
    RADAR_INTERFACE=0.0.0.0 \
    RADAR_UDP_PORT=6678 \
    REPLAY_FRAME_INTERVAL_MS=1000 \
    REPLAY_RETENTION_SECONDS=300

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 8080/tcp
EXPOSE 6678/udp

CMD ["node", "dist/index.js"]
