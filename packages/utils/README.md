# @datespot/utils

Shared helper utilities for the DateSpot server monorepo.

Pure functions with no database or HTTP dependencies.

## Role

- Geographic distance calculation for places sorting
- Cryptographically secure password generation for user registration

## Exports

Source: `src/index.ts`

| Function | Description |
|----------|-------------|
| `getDistanceKm(lat1, lng1, lat2, lng2)` | Haversine formula; returns distance in kilometers |
| `generateRandomPassword(length?)` | Random hex password (default 12 hex chars from 6 bytes) |

## Consumers

- `apps/auth-service` — `generateRandomPassword` on registration
- `apps/places-service` — `getDistanceKm` for list sorting and radius filtering
- `apps/api` — both utilities via mirrored route logic

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile to `dist/` |
| `pnpm dev` | Watch mode |
| `pnpm lint` | Typecheck |

## When editing

- Keep functions pure and side-effect free
- Do not add Express, Prisma, or Redis imports here
- If adding a utility used by only one service, consider keeping it in that service instead

## Related docs

- [apps/places-service/README.md](../../apps/places-service/README.md) — distance sorting
- [apps/auth-service/README.md](../../apps/auth-service/README.md) — password generation
