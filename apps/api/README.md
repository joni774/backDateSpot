# API (`api`)

Express monolith that exposes all REST routes in a single process. Used for **local development** via `pnpm dev` from the repo root.

In Docker, the same URL paths are served by split microservices behind the gateway. See [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) for the dual-runtime model.

## Role

- Single entry point on port **3000** for local dev
- Mounts auth, places, and admin routes under `/api/*`
- Includes `CORS_ORIGIN` configuration for Expo Web / browser clients

## Port / path

| External | Internal |
|----------|----------|
| `http://localhost:3000` | Express app |
| `GET /health` | Health check |
| `/api/auth/*` | Auth routes |
| `/api/places/*` | Places routes |
| `/api/admin/*` | Admin routes |

## Directory structure

```
apps/api/
├── src/
│   ├── index.ts              # Express entry; middleware + route mounting
│   ├── config/
│   │   ├── env.ts            # Zod-validated environment
│   │   └── load-env.ts       # dotenv loader
│   ├── routes/
│   │   ├── auth.routes.ts
│   │   ├── places.routes.ts
│   │   └── admin.routes.ts
│   ├── middleware/
│   │   └── auth.middleware.ts
│   └── utils/                # jwt, password helpers
├── .env.example
└── package.json
```

## Endpoints

All paths are prefixed with `/api`.

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | No | Register user; auto-generate password |
| POST | `/login` | No | Login; returns JWT + user |
| POST | `/change-password` | JWT | Change password |

### Places (`/api/places`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Optional | List places (category, lat/lng/radius, language) |
| GET | `/saved` | JWT | User's saved places |
| POST | `/save` | JWT | Bookmark a place |
| DELETE | `/save/:placeId` | JWT | Remove bookmark |
| GET | `/:id` | Optional | Place detail |

### Admin (`/api/admin`)

All routes require JWT + `isAdmin`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | Dashboard statistics |
| GET | `/places` | List all places (admin view) |
| POST | `/places` | Create place |
| PUT | `/places/:id` | Update place |
| DELETE | `/places/:id` | Soft-delete (set `isActive: false`) |
| PUT | `/places/:id/order` | Update `displayOrder` |
| GET | `/users` | Paginated user list |
| PUT | `/users/:id/subscription` | Update subscription tier |

## Environment

Copy `.env.example` to `.env`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Min 32 characters |
| `PORT` | No | `3000` | Listen port |
| `NODE_ENV` | No | `development` | `development` / `production` / `test` |
| `CORS_ORIGIN` | No | `*` | Comma-separated allowed origins |
| `SENDGRID_API_KEY` | No | — | Optional email integration |
| `REDIS_URL` | No | — | Documented but **not used** in this app |

## Dependencies

- `@datespot/database` — Prisma client
- `@datespot/shared-types` — shared TypeScript types
- `@datespot/utils` — distance and password helpers

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start with `ts-node-dev` (hot reload) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run compiled `dist/index.js` |
| `pnpm lint` | Typecheck (`tsc --noEmit`) |

From repo root: `pnpm dev` runs this package via Turborepo (`--filter=api`).

## Sync with microservices

Route logic is duplicated in the split services for Docker deployment:

| Monolith route file | Microservice |
|---------------------|--------------|
| `src/routes/auth.routes.ts` | [apps/auth-service](../auth-service/README.md) |
| `src/routes/places.routes.ts` | [apps/places-service](../places-service/README.md) |
| `src/routes/admin.routes.ts` | [apps/admin-service](../admin-service/README.md) |

When changing API behavior, update **both** unless the task targets one runtime mode only.

**Known drift:** microservices have login rate limiting and Redis caching that this monolith does not implement yet.

## When editing

- Middleware order in `index.ts`: helmet → cors → json → morgan → routes → 404 → error handler
- Validate request bodies with Zod in route handlers
- Use `verifyTokenMiddleware`, `optionalAuth`, and `requireAdmin` from `middleware/auth.middleware.ts`
