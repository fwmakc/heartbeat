# build: зависимости + компиляция TS
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# финальный образ: distroless, без шелла — атаковать нечего.
# SIGHUP доходит только при exec-форме ENTRYPOINT, никакого sh -c.
FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY config ./config
COPY migrations ./migrations
USER nonroot:nonroot
EXPOSE 8000
ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
