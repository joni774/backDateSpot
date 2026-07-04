# Admin Service (`admin-service`)

Handles admin-only API: dashboard stats, place management, and user subscription updates.

Consumed by the in-app admin panel in [datespot-client](https://github.com/your-org/datespot-client). No web admin UI in this repo.

In Docker, exposed externally as `/api/admin` via the [gateway](../gateway/README.md). Port **3003** is internal only.

## Role

- Dashboard statistics (users, places by category)
- Full places CRUD for admins
- Paginated user list and subscription tier updates
- Invalidate Redis places cache after place mutations

## Port / path

| Internal | External (via gateway) |
|----------|------------------------|
| `http://admin-service:3003` | `http://localhost:3000/api/admin` |
| `GET /health` | — |
| Routes mounted at `/api/admin` | Same paths under gateway |

## Directory structure

```
apps/admin-service/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── load-env.ts
│   ├── routes/
│   │   └── admin.routes.ts
│   ├── middleware/
│   │   └── auth.middleware.ts   # verifyToken + requireAdmin
│   ├── lib/
│   │   └── redis.ts             # invalidatePlacesCache()
│   └── schemas/
│       └── place.schema.ts
├── Dockerfile
└── package.json
```

## Endpoints

Base path: `/api/admin`. All routes require JWT with `isAdmin: true`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/stats` | `{ totalUsers, weeklyActiveUsers, premiumUsers, vipUsers, totalPlaces, placesByCategory }` |
| GET | `/places` | List places; query: `category`, `isActive` |
| POST | `/places` | Create place (he/en/ar names and descriptions) |
| PUT | `/places/:id` | Update place (partial body) |
| DELETE | `/places/:id` | Soft-delete (`isActive: false`) |
| PUT | `/places/:id/order` | Update `displayOrder` |
| GET | `/users` | Paginated users; query: `page`, `limit` |
| PUT | `/users/:id/subscription` | Update tier: `{ tier: "FREE" \| "PREMIUM" \| "VIP" }` |

### Notes

- `weeklyActiveUsers` uses `updatedAt` as a proxy (no `lastLoginAt` in MVP)
- Place `viewCount` always returns `0` until analytics are implemented
- DELETE is a soft delete, not a hard remove

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Min 32 characters |
| `PORT` | No | `3003` | Listen port |
| `NODE_ENV` | No | `development` | Environment |
| `REDIS_URL` | No | — | Enables cache invalidation when set |

## Dependencies

- `@datespot/database` — Prisma client
- `ioredis` — Redis cache invalidation

## Redis cache invalidation

After create, update, delete, or reorder of places, `invalidatePlacesCache()` deletes all keys matching `places:list:*`. This keeps [places-service](../places-service/README.md) list cache consistent.

If `REDIS_URL` is unset, invalidation is a no-op.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run `dist/index.js` |
| `pnpm lint` | Typecheck |

## Sync with monolith

Route logic is mirrored in [apps/api/src/routes/admin.routes.ts](../api/src/routes/admin.routes.ts) for local dev.

When changing admin behavior, update **both** this service and the monolith route file.

**Microservice-only feature:** Redis cache invalidation on place mutations. Not implemented in `apps/api`.

## When editing

- Global middleware on router: `verifyTokenMiddleware` then `requireAdmin`
- Place body requires trilingual fields: `nameHe/En/Ar`, `descriptionHe/En/Ar`
- Always call `invalidatePlacesCache()` after place write operations
