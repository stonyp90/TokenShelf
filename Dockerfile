# syntax=docker/dockerfile:1.7
#
# TokenShelf — Next.js app container.
# Multi-stage build, standalone output, distroless-style runtime.
# Tested for Azure Container Apps (Node 22 LTS).
#
# Build locally:
#   docker build -t tokenshelf-app:dev .
# Build for Azure Container Registry:
#   az acr build -r <registry> -t tokenshelf-app:$(git rev-parse --short HEAD) .

ARG NODE_VERSION=22-alpine
ARG PNPM_VERSION=9.15.0

# ─────────────────────────────  deps  ─────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
RUN apk add --no-cache libc6-compat

COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml* ./
COPY packages ./packages
COPY prisma ./prisma

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod=false

# ─────────────────────────────  build  ────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app

ENV BUILD_STANDALONE=true \
    NEXT_TELEMETRY_DISABLED=1

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/prisma ./prisma
COPY . .

RUN pnpm prisma generate
RUN pnpm build

# ─────────────────────────────  runtime  ──────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache curl tini \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001 -G nodejs

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -fsS http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
