FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY turbo.json ./

COPY packages/database ./packages/database
COPY packages/utils ./packages/utils
COPY packages/shared-types ./packages/shared-types
COPY packages/places-logic ./packages/places-logic
COPY packages/ai-logic ./packages/ai-logic
COPY apps/ai-service ./apps/ai-service

RUN pnpm install
RUN pnpm --filter @datespot/database build
RUN pnpm --filter @datespot/utils build
RUN pnpm --filter @datespot/places-logic build
RUN pnpm --filter @datespot/ai-logic build
RUN pnpm --filter ai-service build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY package.json ./

COPY packages/database ./packages/database
COPY packages/utils ./packages/utils
COPY packages/shared-types ./packages/shared-types
COPY packages/places-logic ./packages/places-logic
COPY packages/ai-logic ./packages/ai-logic
COPY apps/ai-service ./apps/ai-service

RUN pnpm install --prod

COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/packages/places-logic/dist ./packages/places-logic/dist
COPY --from=builder /app/packages/ai-logic/dist ./packages/ai-logic/dist
COPY --from=builder /app/apps/ai-service/dist ./apps/ai-service/dist

EXPOSE 3004
CMD ["node", "apps/ai-service/dist/index.js"]
