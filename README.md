# DateSpot Server

Turborepo monorepo for the DateSpot API backend.

See [datespot-client/README.md](../datespot-client/README.md) for the Expo mobile app.

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Monorepo map, dependencies, where to change what |
| [AGENTS.md](AGENTS.md) | Instructions for AI coding agents |
| [apps/api/README.md](apps/api/README.md) | Monolith API (local dev) |
| [apps/auth-service/README.md](apps/auth-service/README.md) | Auth microservice |
| [apps/places-service/README.md](apps/places-service/README.md) | Places microservice |
| [apps/admin-service/README.md](apps/admin-service/README.md) | Admin microservice |
| [apps/gateway/README.md](apps/gateway/README.md) | nginx gateway (Docker) |
| [packages/database/README.md](packages/database/README.md) | Prisma schema, migrations, seed |
| [packages/shared-types/README.md](packages/shared-types/README.md) | TypeScript types (synced with client) |
| [packages/utils/README.md](packages/utils/README.md) | Shared helpers |

## Dual runtime modes

| Mode | Command | What runs |
|------|---------|-----------|
| **Local dev (monolith)** | `pnpm dev` | [apps/api](apps/api) — all routes on port 3000 |
| **Docker (microservices)** | `docker compose up --build` | auth, places, admin services + [gateway](apps/gateway) on port 3000 |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full request flow and sync rules between modes.

## Architecture / Tech stack (PRD section 9)

| Area | Technology | Status |
|------|------------|--------|
| **9.1 Platforms** | Expo mobile (client repo) with in-app admin screens | Admin UI in mobile app |
| **9.2 Backend** | Node.js + Express + PostgreSQL + Redis (caching) | Express + PostgreSQL implemented; Redis documented, cache layer planned |
| **9.2 Storage** | AWS S3 / Cloudinary | Documented in `.env.example`; upload flow planned |
| **9.2 Location** | Google Maps Platform | Mobile key documented; server keys planned |
| **9.2 Security** | HTTPS, JWT, bcrypt | Implemented |
| **9.3 Email** | SendGrid / AWS SES | Stub in code; full integration planned |
| **9.3 Places** | Google Places API (cold-start import) | Planned |
| **9.3 Push** | Firebase Cloud Messaging | Planned (v2) |
| **9.3 Payments** | Stripe / Tranzila | Planned (v2) |
| **9.4 i18n** | Hebrew, Arabic (RTL), English | Implemented in mobile client |

### Implementation status

**Implemented (MVP):**

- User registration/login with JWT + bcrypt
- Places list, detail, save/unsave, FREE-tier lock logic
- Admin API: stats, places CRUD, user management (consumed by mobile app)
- Prisma schema, migrations, seed data
- Email password delivery logs to console in dev

**Documented only (next phase):**

- Redis response caching for places API
- SendGrid / AWS SES transactional email
- S3 / Cloudinary image uploads
- Google Places API import script for cold start
- Firebase push notifications, Stripe/Tranzila payments

## Structure

| Path | Description |
|------|-------------|
| `apps/api` | Express monolith for local dev (port 3000) |
| `apps/auth-service` | Auth microservice (port 3001, internal) |
| `apps/places-service` | Places microservice (port 3002, internal) |
| `apps/admin-service` | Admin microservice (port 3003, internal) |
| `apps/gateway` | nginx reverse proxy (port 3000 external in Docker) |
| `packages/database` | Prisma schema, migrations, seed |
| `packages/shared-types` | Shared TypeScript types |
| `packages/utils` | Haversine distance, password generation |

## Setup

1. Clone the repo
2. Install dependencies:

```bash
pnpm install
```

3. Copy environment file and fill values:

```bash
cp apps/api/.env.example apps/api/.env
```

4. Start PostgreSQL + Redis (choose one):

```bash
# Option A: Docker microservices (recommended for mobile client)
docker compose up --build
# Migrations + seed run automatically via the db-init container.
# Admin login: admin@datespot.co.il / admin123
# Free-tier test user: free@datespot.co.il / free123

# Option B: Local PostgreSQL on port 5432 with database datespot_dev
```

5. Run migrations and seed (**Option B only** — Docker runs these via `db-init`):

```bash
pnpm db:migrate
pnpm db:seed
```

6. Start the API:

```bash
pnpm dev
```

- API: http://localhost:3000/health
- Admin: use the mobile app (Profile → Admin Panel) with `admin@datespot.co.il` / `admin123`

See also [SETUP.md](../SETUP.md) for full local workspace setup including the mobile client.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Run API |
| `pnpm build` | Build all packages |
| `pnpm db:migrate` | Apply Prisma migrations locally (`apps/api` dev without Docker) |
| `pnpm db:seed` | Seed locally (`apps/api` dev without Docker) |
| `pnpm db:init:docker` | Re-run migrations + seed inside Docker (`db-init` container) |
| `pnpm e2e` | API smoke shim → `../e2e/api/verify.mjs` (API must be running) |

## Environment Variables

Validated at startup via Zod in `apps/api/src/config/env.ts`. Only core variables are enforced today; additional PRD variables are documented in `.env.example` for upcoming integrations.

### Core (validated at startup)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Min 32 characters |
| `PORT` | No | Default `3000` |
| `NODE_ENV` | No | `development` / `production` / `test` |
| `CORS_ORIGIN` | No | Allowed origins for Expo Web / browser clients (default `*`) |
| `SENDGRID_API_KEY` | No | SendGrid API key (optional until email integration) |
| `REDIS_URL` | No | Redis URL; required per PRD for production caching; local default `redis://localhost:6379` via docker compose |

### Planned (documented in `.env.example`, not validated yet)

| Variable | Description |
|----------|-------------|
| `AWS_SES_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM` | AWS SES email alternative |
| `STORAGE_PROVIDER`, `AWS_S3_BUCKET`, `AWS_S3_REGION` | AWS S3 image storage |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary image storage |
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY` | Google Maps Platform / Places API |
| `FCM_SERVER_KEY` | Firebase Cloud Messaging (v2) |
| `STRIPE_SECRET_KEY`, `TRANZILA_TERMINAL` | Payment providers (v2) |

## Seed Data

Seed script: `packages/database/prisma/seed.ts`

**Docker:** runs automatically on `docker compose up` via the `db-init` service (migrate + seed inside the container).

**Local API dev (no Docker):** run `pnpm db:seed` after migrations.

Creates:

- **Admin:** `admin@datespot.co.il` / `admin123` (`isAdmin: true`, VIP tier)
- **Free user:** `free@datespot.co.il` / `free123` (`isAdmin: false`, FREE tier — for E2E lock tests)
- **13 places** in Tel Aviv (romantic, restaurants, sunset, attractions) with he/en/ar names

## Deploy to Railway

See [RAILWAY.md](RAILWAY.md) for the full checklist (PostgreSQL, Redis, env vars, migrations).

Summary:

1. Push this repo to GitHub
2. Create a Railway project → **Deploy from GitHub repo**
3. Add **PostgreSQL** and **Redis** services
4. Set core environment variables (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NODE_ENV`, `CORS_ORIGIN`)
5. Railway uses `railway.json` → builds `apps/api/Dockerfile`, healthcheck `/health`
6. Run migrations after first deploy: `pnpm db:migrate` and `pnpm db:seed`
7. Copy the public Railway URL to the mobile app:

```env
# datespot-client/apps/mobile/.env
EXPO_PUBLIC_API_URL=https://your-app.up.railway.app
```

## E2E Verification

API smoke tests live in the sibling [`e2e/`](../e2e/) repo. From `datespot-server`, `pnpm e2e` runs the same verify script via a shim.

With API running locally:

```bash
pnpm e2e
# Or from e2e repo:
cd ../e2e && pnpm api
# Or against Railway:
API_URL=https://your-app.up.railway.app node ../e2e/api/verify.mjs
```

Full E2E (API + Playwright web): see [e2e/README.md](../e2e/README.md).

Checks: health, admin login, places list, save/saved/unsave, FREE user lock, place detail, admin stats.

## Notes

- `weeklyActiveUsers` in admin stats uses `updatedAt` as a proxy (no `lastLoginAt` in MVP)
- Place view counts return `0` until analytics are implemented
- Admin UI lives in the mobile app (`datespot-client`); this repo exposes `/api/admin/*` only
