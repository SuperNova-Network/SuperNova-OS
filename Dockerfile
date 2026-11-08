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

# Run as the unprivileged user that ships with the image.
USER node

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "app.js"]
