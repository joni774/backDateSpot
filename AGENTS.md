# DateSpot Server — Agent Instructions

Instructions for AI coding agents working in this repository.

## Read first

1. This file (repo-wide rules)
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the monorepo map and dependency graph
3. The README of the package you are editing (see table below)

## Package docs

| When editing | Read |
|--------------|------|
| `apps/api/**` | [apps/api/README.md](apps/api/README.md) |
| `apps/auth-service/**` | [apps/auth-service/README.md](apps/auth-service/README.md) |
| `apps/places-service/**` | [apps/places-service/README.md](apps/places-service/README.md) |
| `apps/admin-service/**` | [apps/admin-service/README.md](apps/admin-service/README.md) |
| `apps/gateway/**` | [apps/gateway/README.md](apps/gateway/README.md) |
| `packages/database/**` | [packages/database/README.md](packages/database/README.md) |
| `packages/shared-types/**` | [packages/shared-types/README.md](packages/shared-types/README.md) |
| `packages/utils/**` | [packages/utils/README.md](packages/utils/README.md) |
| `packages/auth-logic/**` | Shared auth route handlers (`createAuthRouter`) |

## Commands (from repo root)

```bash
pnpm install
pnpm dev                          # Monolith apps/api on :3000
docker compose --profile dev up --build              # Lean stack: postgres + redis + api on :3000
docker compose --profile microservices up --build    # Full microservices + gateway on :3000
pnpm build                        # turbo build all packages
pnpm lint                         # turbo lint all packages
pnpm db:migrate                   # Apply Prisma migrations (local dev)
pnpm db:seed                      # Seed database (local dev)
pnpm db:init:docker               # Re-run migrate + seed in Docker
pnpm e2e                          # API smoke shim → ../e2e/api/verify.mjs
```

Service-only:

```bash
pnpm --filter api dev
pnpm --filter @datespot/database exec prisma migrate dev --name change_name
```

## Conventions

- TypeScript strict; match existing import style
- Workspace packages use the `@datespot/*` scope
- Env validation: Zod schemas in each app's `src/config/env.ts`; fail fast at startup
- Express middleware order: helmet → cors → json → morgan → routes → 404 → error handler
- Database access: import `prisma` from `@datespot/database`; never instantiate `PrismaClient` in apps
- Request validation: Zod schemas in route handlers
- JWT: shared `JWT_SECRET` across all services; middleware in each app's `middleware/auth.middleware.ts`
- Types: keep `packages/shared-types` in sync with `datespot-client/packages/shared-types`

## Dual runtime modes — CRITICAL

| Mode | Command | What runs |
|------|---------|-----------|
| Local dev | `pnpm dev` | `apps/api` monolith (all routes) |
| Docker (lean) | `docker compose --profile dev up --build` | postgres + redis + `apps/api` on :3000 |
| Docker (microservices) | `docker compose --profile microservices up --build` | Split services + nginx gateway |

When changing API route behavior, update the relevant **microservice** and the matching route file in **`apps/api`** unless the task explicitly targets one mode only.

**Known drift (document, do not assume parity):**

- `auth-service` has login rate limiting; `apps/api` does not
- `places-service` / `admin-service` use Redis caching; `apps/api` does not

## Boundaries — do NOT

- Commit `.env` files, API keys, or secrets
- Change client code when the task is server-only (client lives in `../datespot-client`)
- Add heavy abstractions for one-off use
- Create Prisma migrations without updating `packages/database/prisma/schema.prisma`
- Add gateway routes without a corresponding upstream service handler
- Import React or mobile UI code into server packages

## Verification

After route or API changes:

```bash
cd ../e2e && pnpm api
# Or from this repo (shim):
pnpm e2e
# Or against a running stack:
API_URL=http://localhost:3000 node ../e2e/api/verify.mjs
```

After microservice changes, rebuild Docker:

```bash
docker compose --profile dev up --build
# or
docker compose --profile microservices up --build
```

If `shared-types` changed:

```bash
pnpm build
# Also sync datespot-client/packages/shared-types
```

After schema changes:

```bash
pnpm db:migrate
pnpm db:seed
```

Manual checklist: see [e2e/README.md](../e2e/README.md).

Full E2E suite (API + Playwright + Maestro): [e2e/README.md](../e2e/README.md).

Mobile client setup: [datespot-client/README.md](../datespot-client/README.md).
