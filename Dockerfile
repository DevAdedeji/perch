# syntax=docker/dockerfile:1

# ---------- builder ----------
FROM node:22-slim AS builder
ENV NITRO_PRESET=node-server
RUN corepack enable
WORKDIR /app

# full source (pnpm workspace + postinstall `nuxt prepare` need it)
COPY . .
RUN pnpm install --frozen-lockfile

# build the embeddable widget.js, then the Nuxt/Nitro server
RUN pnpm --filter @perch/widget-loader build \
  && pnpm build

# ---------- runner ----------
FROM node:22-slim AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
WORKDIR /app

# Nitro's .output is self-contained (bundles the deps it needs)
COPY --from=builder /app/.output ./.output

EXPOSE 8000
CMD ["node", ".output/server/index.mjs"]
