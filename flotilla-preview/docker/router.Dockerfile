# Build from repo root: docker build -f docker/router.Dockerfile -t flotilla-preview-router .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
RUN npm ci
RUN npm run build -w @flotilla/shared -w @flotilla/router

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/services/router ./services/router
RUN mkdir -p /app/node_modules/@flotilla \
  && rm -rf /app/node_modules/@flotilla/shared \
  && ln -s /app/packages/shared /app/node_modules/@flotilla/shared
EXPOSE 3102
CMD ["node", "services/router/dist/index.js"]
