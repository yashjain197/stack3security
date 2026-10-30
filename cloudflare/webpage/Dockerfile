FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --chown=node:node package.json server.js ./
COPY --chown=node:node dist ./dist

USER node

EXPOSE 3000

CMD ["node", "server.js"]
