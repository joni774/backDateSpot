FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY turbo.json ./

COPY packages/database ./packages/database
COPY packages/utils ./packages/utils
COPY packages/shared-types ./packages/shared-types
COPY packages/auth-logic ./packages/auth-logic
COPY apps/auth-service ./apps/auth-service

RUN pnpm install
RUN pnpm --filter @datespot/database build
RUN pnpm --filter @datespot/utils build
RUN pnpm --filter @datespot/auth-logic build
RUN pnpm --filter auth-service build

# ---- runtime ----
FROM node:20-alpine AS runtime
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY package.json ./

COPY packages/database ./packages/database
COPY packages/utils ./packages/utils
COPY packages/shared-types ./packages/shared-types
COPY packages/auth-logic ./packages/auth-logic
COPY apps/auth-service ./apps/auth-service

RUN pnpm install --prod

COPY --from=builder /app/packages/database/dist ./packages/database/dist
COPY --from=builder /app/packages/utils/dist ./packages/utils/dist
COPY --from=builder /app/packages/auth-logic/dist ./packages/auth-logic/dist
COPY --from=builder /app/apps/auth-service/dist ./apps/auth-service/dist

EXPOSE 3001
CMD ["node", "apps/auth-service/dist/index.js"]
