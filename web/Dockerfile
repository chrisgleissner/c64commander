# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV VITE_WEB_PLATFORM=1
RUN npm run build && npm run build:web-server

FROM node:24-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV WEB_CONFIG_DIR=/config
ENV WEB_DIST_DIR=/app/dist
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/server/dist ./web/server/dist
RUN mkdir -p /config && chown -R node:node /app /config
USER node
EXPOSE 8080
VOLUME ["/config"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "const http=require('node:http');const req=http.get('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));"
CMD ["node", "web/server/dist/index.js"]
