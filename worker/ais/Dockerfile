# Long-lived AIS worker for Grid's Eye View. Not part of the Vite/Vercel build.
# Built and validated locally; NOT deployed by this change (deploy is a separate,
# explicit step the user runs themselves with `fly deploy`).

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY terminals.geojson ./terminals.geojson

# Secrets (AISSTREAM_API_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY) come from Fly
# secrets as real environment variables at runtime, not from a .env file — the
# container never has one, and --env-file would fail fast against a missing
# file. Local dev/record use --env-file against the repo-root .env instead
# (see package.json scripts); that flag stays out of this file on purpose.
CMD ["node", "dist/runner.js"]
