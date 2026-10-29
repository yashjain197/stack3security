# Dev/test image for the Stack3 VS Code extension.
# Pinned by digest; bump deliberately. node:22-bookworm-slim, Node v22.23.4.
FROM node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da

# git is needed by the quarantine clone tests (Task 11).
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir /app && chown node:node /app
WORKDIR /app
USER node

# Dependencies first for layer caching. .npmrc sets ignore-scripts=true.
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY --chown=node:node . .
CMD ["npm", "test"]
