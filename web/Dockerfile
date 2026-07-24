# syntax=docker/dockerfile:1.7

FROM node:24-trixie-slim AS build
WORKDIR /app
ARG VITE_APP_VERSION
ARG VITE_GIT_SHA
ARG VITE_BUILD_TIME
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY index.html ./
COPY tsconfig*.json ./
COPY vite.config.ts ./
COPY tailwind.config.ts ./
COPY postcss.config.js ./
COPY components.json ./
COPY scripts ./scripts
COPY src ./src
COPY public ./public
COPY variants ./variants
COPY docs/c64 ./docs/c64
COPY docs/img/c64commander.png ./docs/img/c64commander.png
COPY web ./web
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_GIT_SHA=$VITE_GIT_SHA
ENV VITE_BUILD_TIME=$VITE_BUILD_TIME
ENV VITE_WEB_PLATFORM=1
RUN npm run build && npm run build:web-server

FROM node:24-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8064
ENV WEB_CONFIG_DIR=/config
ENV WEB_DIST_DIR=/app/dist
# A/V mirror UDP→WebSocket bridge: on by default in the shipped image so Live View works
# out of the box (the device streams VIC video / audio to these UDP ports). Set
# WEB_STREAM_BRIDGE=0 to disable.
ENV WEB_STREAM_BRIDGE=1
ENV WEB_STREAM_VIDEO_PORT=11000
ENV WEB_STREAM_AUDIO_PORT=11001
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/web/server/dist ./web/server/dist
RUN mkdir -p /config && chown node:node /config
USER node
EXPOSE 8064
EXPOSE 11000/udp
EXPOSE 11001/udp
VOLUME ["/config"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "const http=require('node:http');const req=http.get('http://127.0.0.1:'+(process.env.PORT||8064)+'/healthz',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));"
CMD ["node", "web/server/dist/index.js"]
