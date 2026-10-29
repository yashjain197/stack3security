# Two images from one file. Pinned by digest; bump deliberately. node:22-bookworm-slim, Node v22.23.4.
#   docker build .                       -> the repo-scan SERVICE (the last stage, so the default)
#   docker build --target dev .         -> the dev/test image (see compose.yaml)
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS base

# git does the hardened clone. Debian's 2.39.5 includes the CVE-2024-32002 fix; the service refuses to clone with any git
# older than the first patched release of its series.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir /app && chown node:node /app
WORKDIR /app
USER node

# ---- dev: dependencies and sources, runs the tests ----------------------------------------------------------------
FROM base AS dev
# Dependencies first for layer caching. .npmrc sets ignore-scripts=true.
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY --chown=node:node . .
CMD ["npm", "test"]

# ---- build: bundles dist/server.js and dist/worker.js -------------------------------------------------------------
FROM dev AS build
RUN npm run build

# ---- service: only the two bundles, no node_modules, no sources ---------------------------------------------------
FROM base AS service
COPY --from=build --chown=node:node /app/dist/server.js /app/dist/worker.js ./dist/
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
# SERVICE_KEY is required (the container refuses to start without it). See SERVER.md for the rest.
CMD ["node", "dist/server.js"]
