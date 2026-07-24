# Build from repo root: docker build -f docker/orchestrator.Dockerfile -t flotilla-preview-orchestrator .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY services ./services
COPY apps/dashboard ./apps/dashboard
COPY config ./config
RUN npm ci
RUN npm run build -w @flotilla/shared -w @flotilla/dashboard -w @flotilla/orchestrator

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV DASHBOARD_DIST=/app/apps/dashboard/dist
COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/services/orchestrator ./services/orchestrator
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build /app/config ./config
RUN mkdir -p /app/node_modules/@flotilla \
  && rm -rf /app/node_modules/@flotilla/shared \
  && ln -s /app/packages/shared /app/node_modules/@flotilla/shared \
  && mkdir -p /app/data
EXPOSE 3101
CMD ["node", "services/orchestrator/dist/index.js"]
