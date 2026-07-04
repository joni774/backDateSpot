# One-shot container: migrations + seed (Docker only).
FROM node:20-alpine
WORKDIR /app

RUN npm install -g pnpm

COPY pnpm-workspace.yaml ./
COPY package.json ./

COPY packages/database ./packages/database

RUN pnpm install --filter @datespot/database...

WORKDIR /app/packages/database

CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]
