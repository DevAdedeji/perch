# syntax=docker/dockerfile:1

# ---------- builder ----------
FROM node:22-slim AS builder
ENV NITRO_PRESET=node-server
# raise V8's heap ceiling — the Nitro bundle OOMs on the default ~2 GB limit
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN corepack enable
WORKDIR /app

# full source (pnpm workspace + postinstall `nuxt prepare` need it)
COPY . .
RUN pnpm install --frozen-lockfile

# build the embeddable widget.js, then the Nuxt/Nitro server
RUN pnpm --filter @perch/widget-loader build \
  && pnpm build

# bundle the deploy-time migrator to a standalone file (drizzle + postgres inlined)
RUN npx esbuild scripts/migrate.mjs --bundle --platform=node --format=esm \
  --outfile=/app/migrate.bundle.mjs --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# ---------- runner ----------
FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
WORKDIR /app

# Nitro's .output is self-contained (bundles the deps it needs)
COPY --from=builder /app/.output ./.output
# deploy-time migrations: schema lands before the server boots
COPY --from=builder /app/migrate.bundle.mjs ./migrate.bundle.mjs
COPY --from=builder /app/packages/db/migrations ./migrations

EXPOSE 8000
CMD ["sh", "-c", "node migrate.bundle.mjs && node .output/server/index.mjs"]
