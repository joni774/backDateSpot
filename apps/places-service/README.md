# Places Service (`places-service`)

Handles public place discovery, detail views, and user bookmarks.

In Docker, exposed externally as `/api/places` via the [gateway](../gateway/README.md). Port **3002** is internal only.

## Role

- List nearby places with distance sorting and i18n localization
- Enforce FREE-tier lock (first 5 places unlocked, rest marked `isLocked`)
- Serve place detail with freemium gate on deep access
- Manage user saved places (bookmark / unbookmark)
- Cache place list queries in Redis

## Port / path

| Internal | External (via gateway) |
|----------|------------------------|
| `http://places-service:3002` | `http://localhost:3000/api/places` |
| `GET /health` | — |
| Routes mounted at `/api/places` | Same paths under gateway |

## Directory structure

```
apps/places-service/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── load-env.ts
│   ├── routes/
│   │   └── places.routes.ts
│   ├── middleware/
│   │   └── auth.middleware.ts
│   ├── lib/
│   │   └── redis.ts           # List cache (key: places:list:*)
│   ├── schemas/
│   │   └── place.schema.ts
│   └── utils/
│       ├── place.util.ts      # i18n, opening hours
│       └── jwt.util.ts
├── Dockerfile
└── package.json
```

## Endpoints

Base path: `/api/places`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Optional | List places; query: `category`, `lat`, `lng`, `radius`, `language` |
| GET | `/saved` | JWT | User's saved places |
| POST | `/save` | JWT | Bookmark `{ placeId }` |
| DELETE | `/save/:placeId` | JWT | Remove bookmark |
| GET | `/:id` | Optional | Place detail; query: `language` |

### FREE tier lock

- **List:** Places beyond index 5 get `isLocked: true` for FREE users
- **Detail:** FREE users get `403 Premium required` if place rank ≥ 5 by `displayOrder`
- PREMIUM and VIP tiers bypass the lock

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Min 32 characters |
| `PORT` | No | `3002` | Listen port |
| `NODE_ENV` | No | `development` | Environment |
| `REDIS_URL` | No | — | Enables list caching when set |

## Dependencies

- `@datespot/database` — Prisma client
- `@datespot/utils` — `getDistanceKm` for distance sorting
- `ioredis` — Redis caching

## Redis caching

Defined in `src/lib/redis.ts`:

| Constant | Value | Description |
|----------|-------|-------------|
| `PLACES_LIST_KEY` | `places:list` | Key prefix |
| `PLACES_LIST_TTL` | `120` | Cache TTL in seconds |

Cache key format: `places:list:{category}:{lat}:{lng}:{radius}`

Language is applied after cache read. Cache is invalidated by [admin-service](../admin-service/README.md) on place mutations.

If `REDIS_URL` is unset, caching is skipped gracefully.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run `dist/index.js` |
| `pnpm lint` | Typecheck |

## Sync with monolith

Route logic is mirrored in [apps/api/src/routes/places.routes.ts](../api/src/routes/places.routes.ts) for local dev.

When changing places behavior, update **both** this service and the monolith route file.

**Microservice-only feature:** Redis list caching. Not implemented in `apps/api`.

## When editing

- Use `optionalAuth` for routes that work with or without JWT
- Use `verifyTokenMiddleware` for saved/bookmark routes
- Bounding-box pre-filter in Prisma, then exact Haversine sort via `@datespot/utils`
- Localize names/descriptions with `localizePlace(place, language)`
