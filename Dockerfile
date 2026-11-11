# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only. Install scripts are skipped: nothing here needs a
# native build (bufferutil falls back to JavaScript) and Scramjet's pnpm-only
# preinstall guard would otherwise want to reach the network.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM base
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Accounts database (ACCOUNTS=1). Mount a volume here so it survives new images.
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown node:node /app/data

# Start as root only to make a freshly mounted volume writable, then the entrypoint
# drops to the unprivileged user that ships with the image.
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "app.js"]
