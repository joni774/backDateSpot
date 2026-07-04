FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY turbo.json ./

COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types
COPY packages/utils ./packages/utils
COPY packages/places-logic ./packages/places-logic
COPY packages/admin-logic ./packages/admin-logic
COPY apps/admin-service ./apps/admin-service

RUN pnpm install
RUN pnpm --filter @datespot/database build
RUN pnpm --filter @datespot/utils build
RUN pnpm --filter @datespot/places-logic build
RUN pnpm --filter @datespot/admin-logic build
RUN pnpm --filter admin-service build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY package.json ./

COPY packages/database ./packages/database
COPY packages/shared-types ./packages/shared-types
COPY packages/utils ./packages/utils
COPY packages/places-logic ./packages/places-logic
COPY packages/admin-logic ./packages/admin-logic
COPY apps/admin-service ./apps/admin-service

RUN pnpm install --prod

COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/packages/places-logic/dist ./packages/places-logic/dist
COPY --from=builder /app/packages/admin-logic/dist ./packages/admin-logic/dist
COPY --from=builder /app/apps/admin-service/dist ./apps/admin-service/dist

EXPOSE 3003
CMD ["node", "apps/admin-service/dist/index.js"]
