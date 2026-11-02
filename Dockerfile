# Image produksi aplikasi kasir. Tiga tahap supaya yang dibawa ke server cuma yang perlu:
# deps (install) → build (next build, output standalone) → runner (hasil build saja).

FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Nilai sementara hanya untuk lolos validasi saat build (next build tidak membuka database). Nilai sungguhan masuk saat
# container berjalan, jadi tidak ada rahasia yang tertinggal di dalam image.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-not-a-secret-000000 \
    BETTER_AUTH_URL=http://localhost:3000 \
    pnpm build

# Migrasi & seed butuh paket dev (drizzle-kit, tsx). Dipakai layanan `migrate` di docker-compose.prod.yml.
FROM base AS tools
COPY --from=deps /app/node_modules ./node_modules
COPY . .

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN groupadd --system app && useradd --system --gid app app
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
