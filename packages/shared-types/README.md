# @datespot/shared-types

TypeScript types for API request/response shapes. This package contains **types only** — no runtime code.

Must stay aligned with [datespot-client/packages/shared-types](../../../datespot-client/packages/shared-types).

## Role

- Define shared interfaces for places, auth, and admin API responses
- Provide enum unions mirrored from Prisma enums
- Serve as the contract between server and mobile client

## Key exports

Source: `src/index.ts`

### Enums / unions

- `SubscriptionTier` — `FREE` | `PREMIUM` | `VIP`
- `PlaceCategory` — `ROMANTIC_DATE`, `RESTAURANT`, `DAIRY_RESTAURANT`, `MEAT_RESTAURANT`, `SUSHI`, `SUNSET`, `ATTRACTION`
- `PriceRange` — `FREE` | `BUDGET` | `MODERATE` | `EXPENSIVE`
- `Language` — `he` | `en` | `ar`

### API types

- `PlaceListItem`, `PlaceDetail` — public places API
- `AuthUser` — user object returned on login
- `AdminUserListItem` — admin user list item
- `PaginatedResponse<T>`, `ApiError` — generic wrappers

## Consumers

- `apps/api` — type references in route handlers
- `datespot-client/packages/shared-types` — mirrored copy for mobile
- `datespot-client/packages/api-client` — HTTP wrapper return types

## Sync rule

When an API response shape changes:

1. Update `packages/shared-types/src/index.ts` in **this repo**
2. Update `packages/shared-types/src/index.ts` in **datespot-client**
3. Update `@datespot/api-client` wrappers if endpoints or fields changed
4. Run `pnpm build` in both repos

Keep field names and enum values aligned with actual JSON responses from the API.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile to `dist/` |
| `pnpm lint` | Typecheck |

## Conventions

- No imports from Express, Prisma, or other runtime libraries
- Prefer `interface` for object shapes; use `type` for unions
- Enum string values must match Prisma schema enums exactly

## Related docs

- [datespot-client/packages/shared-types/README.md](../../../datespot-client/packages/shared-types/README.md)
- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md)
