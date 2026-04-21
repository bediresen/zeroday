# syntax=docker/dockerfile:1
# Production Nuxt/Nitro: build produces `.output/`; runtime runs `node .output/server/index.mjs`.

FROM node:20-bookworm-slim AS builder

WORKDIR /app

ENV NODE_ENV=development
ENV NUXT_TELEMETRY_DISABLED=1


RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
RUN npm run build

# ---

FROM node:20-bookworm-slim AS production


WORKDIR /app

ENV NODE_ENV=production
ENV NUXT_TELEMETRY_DISABLED=1
# Nitro / listhen: listen on all interfaces inside the container
ENV HOST=0.0.0.0
ENV NITRO_HOST=0.0.0.0
ENV PORT=3000
ENV NITRO_PORT=3000

RUN groupadd --gid 1001 nodejs \
  && useradd --uid 1001 --gid nodejs --shell /usr/sbin/nologin --create-home nodejs

COPY --from=builder --chown=nodejs:nodejs /app/.output ./.output

COPY --from=builder --chown=nodejs:nodejs /app/assets ./assets

USER nodejs

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
