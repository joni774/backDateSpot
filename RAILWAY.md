# Railway deployment checklist

Use this after pushing `datespot-server` to GitHub.

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
| `JWT_SECRET` | Random 32+ character string |
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `*` (default) or your Expo Web origin if testing in browser |

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

Railway auto-deploys on push to `main`. Build uses `railway.json` + `apps/api/Dockerfile`.

Verify: `curl https://YOUR-APP.up.railway.app/health`

## 7. Run migrations (one-time)

```bash
railway run pnpm db:migrate
railway run pnpm db:seed
```

Or use Railway shell with the same commands.

## 8. Update mobile app URL

In `datespot-client/apps/mobile/.env`:

```env
EXPO_PUBLIC_API_URL=https://YOUR-APP.up.railway.app
EXPO_PUBLIC_GOOGLE_MAPS_KEY=your-google-maps-key
```

Restart Expo: `pnpm --filter mobile dev`

## 9. E2E against Railway

```bash
cd datespot-server
API_URL=https://YOUR-APP.up.railway.app pnpm e2e
```

Expected: all checks pass (health, admin login, places, lock logic, admin stats).
