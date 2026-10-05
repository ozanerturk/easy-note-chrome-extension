FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# production dependencies on their own, so nothing from the build step rides along
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# better-sqlite3 ships a prebuilt binary for common platforms; the compiler is
# only brought in when there isn't one, so the usual build stays quick
RUN npm ci --omit=dev || ( \
      apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
      && rm -rf /var/lib/apt/lists/* \
      && npm ci --omit=dev )

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# the SQLite file lives here, on a volume, so a new image keeps its data
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
