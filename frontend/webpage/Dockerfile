FROM node:24-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app

COPY --chown=node:node package.json server.js index.html app.js api.js account.js graph.js html.js styles.css mock-data.js security-service.js ./

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "try { const response = await fetch('http://127.0.0.1:' + process.env.PORT + '/', { signal: AbortSignal.timeout(3000) }); process.exit(response.ok ? 0 : 1); } catch (error) { console.error(error); process.exit(1); }"]

CMD ["node", "server.js"]