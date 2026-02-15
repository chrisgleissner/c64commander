# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV VITE_WEB_PLATFORM=1
RUN npm run build && npm run build:web-server

FROM node:20-bookworm-slim AS runtime
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
EXPOSE 8080
VOLUME ["/config"]
CMD ["node", "web/server/dist/index.js"]
