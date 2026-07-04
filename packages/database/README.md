# @datespot/database

Prisma client, schema, migrations, and seed data for the DateSpot PostgreSQL database.

All Express services import the shared Prisma singleton from this package — do not create new `PrismaClient` instances in app code.

## Role

- Define database models (User, Place, SavedPlace)
- Export Prisma client singleton from `src/index.ts`
- Re-export Prisma enums and types (`SubscriptionTier`, `PlaceCategory`, `PriceRange`, etc.)
- Manage migrations and seed script

## Directory structure

```
packages/database/
├── prisma/
│   ├── schema.prisma       # Models and enums
│   ├── seed.ts             # Dev seed data
│   └── migrations/         # SQL migration history
├── src/
│   └── index.ts            # Prisma singleton + re-exports
├── Dockerfile              # db-init container (migrate + seed)
└── package.json
```

## Models

| Model | Description |
|-------|-------------|
| `User` | App users: auth, subscription tier, admin flag |
| `Place` | Date spots with trilingual names/descriptions |
| `SavedPlace` | User bookmarks (many-to-many join) |

## Scripts

From repo root:

| Command | Description |
|---------|-------------|
| `pnpm db:migrate` | Apply pending migrations (`prisma migrate deploy`) |
| `pnpm db:seed` | Run seed script |
| `pnpm db:init:docker` | Re-run migrate + seed in Docker (`db-init` container) |

From this package:

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript wrapper |
| `pnpm dev` | Watch mode for `src/index.ts` |
| `pnpm lint` | Typecheck |

## Migration workflow

1. Edit `prisma/schema.prisma`
2. Create migration: `pnpm --filter @datespot/database exec prisma migrate dev --name your_change`
3. Commit both `schema.prisma` and the new migration folder
4. Apply in other environments: `pnpm db:migrate`

**Docker:** migrations and seed run automatically on `docker compose up` via the `db-init` service.

**Local dev (no Docker):** run `pnpm db:migrate` then `pnpm db:seed` after starting PostgreSQL.

## Seed data

Script: `prisma/seed.ts`

Creates:

- **Admin user:** `admin@datespot.co.il` / `admin123` (`isAdmin: true`, VIP tier)
- **10 places** in Tel Aviv with he/en/ar names across categories

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |

Set in each app's `.env` or via `docker-compose.yml` for containers.

## Usage in services

```typescript
import { prisma, SubscriptionTier, PlaceCategory } from "@datespot/database";
```

The singleton avoids connection exhaustion in development via `globalThis` caching.

## When editing

- Schema changes require a new migration — never edit production DB manually
- Update seed data when adding required fields or new enum values
- After schema changes, run `prisma generate` (automatic via `postinstall`)
- Keep enums in sync with `packages/shared-types` and the mobile client

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
- [packages/shared-types/README.md](../shared-types/README.md)
