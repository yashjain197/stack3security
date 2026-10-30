# Build the React + TypeScript + Vite website, then serve the static bundle
# with a minimal Node server that also exposes runtime config at /config.json.
FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --chown=node:node package.json server.js ./
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "try { const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/', { signal: AbortSignal.timeout(3000) }); process.exit(response.ok ? 0 : 1); } catch (error) { console.error(error); process.exit(1); }"]

CMD ["node", "server.js"]
