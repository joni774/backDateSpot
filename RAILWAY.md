# Railway deployment checklist

Use this after pushing `datespot-server` to GitHub.

## Staging vs Production

Use **separate Railway projects** — never share databases or secrets between them.

| | Staging | Production |
|---|---------|------------|
| Project | `datespot-staging` | `datespot-production` |
| Public URL | `https://datespot-server-production.up.railway.app` | `https://datespot-server-production-ecb2.up.railway.app` |
| Purpose | QA, EAS preview builds, manual testing | Live users |
| Seed | Manual once (see below) | **Never** run `pnpm db:seed` |
| `JWT_SECRET` | Staging-only random string (≥32 chars) | **Different** production-only secret |
| Test users | `admin@datespot.co.il` / `admin123`, `free@datespot.co.il` / `free123` (from seed) | Create admin via secure one-time setup only |

**Startup behavior:** The Docker image runs `prisma migrate deploy` on every container start. It does **not** run seed automatically — seed contains fixed demo passwords and must not run in Production.

## 1. Login to Railway

```bash
railway login
```

## 2. Create project and link repo

```bash
cd datespot-server
railway init
railway link
```

Or connect via [Railway Dashboard](https://railway.app) → New Project → Deploy from GitHub.

For Production, create a **new** project (`datespot-production`) — do not add a Production environment inside Staging.

## 3. Add PostgreSQL

In Railway dashboard: **Add Service → Database → PostgreSQL**

Copy the `DATABASE_URL` from the PostgreSQL service variables.

## 4. Add Redis

Per PRD 9.2 (caching), add a Redis service:

**Add Service → Database → Redis** (or deploy a Redis template)

Copy `REDIS_URL` from the Redis service variables (e.g. `redis://default:password@redis.railway.internal:6379`).

Reference it on the API service as `${{Redis.REDIS_URL}}` if using Railway variable references.

## 5. Set API environment variables

### Core (required)

| Variable | Example |
|----------|---------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference from plugin) |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` (reference from Redis service) |
| `JWT_SECRET` | Random 32+ character string (**unique per project**) |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `*` (default) or your Expo Web origin if testing in browser |
| `PUBLIC_API_URL` | `https://YOUR-APP.up.railway.app` (recommended) |

### Optional until implemented (documented in `apps/api/.env.example`)

These are part of PRD section 9 but not required for MVP API startup:

| Variable | Purpose |
|----------|---------|
| `SENDGRID_API_KEY` | Registration/password emails (SendGrid) |
| `AWS_SES_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `EMAIL_FROM` | Email via AWS SES |
| `STORAGE_PROVIDER`, `AWS_S3_BUCKET`, `AWS_S3_REGION` | Image storage (S3) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Image storage (Cloudinary) |
| `GOOGLE_MAPS_API_KEY`, `GOOGLE_PLACES_API_KEY` | Maps / Places import |
| `FCM_SERVER_KEY` | Push notifications (v2) |
| `STRIPE_SECRET_KEY`, `TRANZILA_TERMINAL` | Payments (v2) |

## 6. Deploy

Railway auto-deploys on push to `main`. Build uses `railway.json` + root `Dockerfile`.

Verify: `curl https://YOUR-APP.up.railway.app/health`

Migrations run automatically on container startup (`prisma migrate deploy`).

## 7. Database setup

### Staging only — seed demo data (one-time)

After the first successful deploy to **Staging**, seed test users and sample places:

```bash
# Link to datespot-staging, then:
railway run pnpm db:seed
```

Or use Railway shell with the same command.

This creates `admin@datespot.co.il` / `admin123` and `free@datespot.co.il` / `free123` plus 13 Tel Aviv places. Safe for Staging only.

Re-run seed only if you need to reset Staging data (it upserts users/places).

### Production — migrations only, no seed

Production containers apply migrations on startup. **Do not** run `pnpm db:seed` in Production.

Create the initial admin user securely:

1. Generate a strong password and store it in a password manager.
2. Use Railway shell once after first deploy:

```bash
railway run node -e "
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const hash = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD, 12);
  await prisma.user.upsert({
    where: { email: 'admin@datespot.co.il' },
    update: {},
    create: {
      email: 'admin@datespot.co.il',
      passwordHash: hash,
      name: 'Admin',
      role: 'ADMIN',
      tier: 'PREMIUM',
    },
  });
  console.log('Admin user ready');
  await prisma.\$disconnect();
})();
"
```

Set `ADMIN_INITIAL_PASSWORD` as a one-time Railway variable, run the command, then **delete** that variable.

Import places separately via admin API or a controlled migration script — not the dev seed.

### Production — remove accidental seed data (one-time)

If the first deploy ran before seed was removed from startup, demo users/places may remain in Postgres even though later deploys only run migrations. Clear them once:

```bash
# Link to datespot-production, then in Railway shell on Postgres or via datespot-server:
railway run sh -c 'cd packages/database && npx prisma db execute --stdin <<SQL
DELETE FROM "SavedPlace";
DELETE FROM "Place";
DELETE FROM "User";
SQL'
```

Then create the initial admin via the secure one-time command in the section above. Do **not** run `pnpm db:seed` in Production.

## 8. Update mobile app URL

In `datespot-client/apps/mobile/.env` (or EAS profile env):

```env
EXPO_PUBLIC_API_URL=https://YOUR-APP.up.railway.app
EXPO_PUBLIC_GOOGLE_MAPS_KEY=your-google-maps-key
```

Restart Expo: `pnpm --filter mobile dev`

## 9. E2E against Railway

```bash
cd e2e
node api/verify.mjs https://datespot-server-production.up.railway.app
```

Expected: all checks pass (health, admin login, places, lock logic, admin stats).

**Last verified (Staging):** `GET /health` → `{"status":"ok","service":"datespot-api"}`; `node api/verify.mjs` → **11 passed, 0 failed**.

**Staging manual checklist** (mobile app pointed at Staging URL):

- [x] Admin login (`admin@datespot.co.il` / `admin123`) — verified via API smoke
- [x] Free user login (`free@datespot.co.il` / `free123`) — verified via API smoke
- [x] Places list loads; place 6+ shows lock for FREE tier — verified via API smoke
- [x] Save / unsave a place — verified via API smoke
- [ ] Map screen on a physical device (not web) — requires manual test on device with `EXPO_PUBLIC_API_URL` set to Staging
- [x] Admin stats screen — verified via API smoke (`GET /api/admin/stats`)

Only promote to Production after Staging passes API smoke + manual checklist (including map on device).
