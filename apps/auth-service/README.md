# Auth Service (`auth-service`)

Handles user registration, login, and password change.

In Docker, exposed externally as `/api/auth` via the [gateway](../gateway/README.md). Port **3001** is internal only.

## Role

- Register new users with auto-generated passwords
- Authenticate users and issue JWT tokens
- Allow authenticated password changes
- Apply rate limiting on login attempts (microservice only)

## Port / path

| Internal | External (via gateway) |
|----------|------------------------|
| `http://auth-service:3001` | `http://localhost:3000/api/auth` |
| `GET /health` | — |
| Routes mounted at `/api/auth` | Same paths under gateway |

## Directory structure

```
apps/auth-service/
├── src/
│   ├── index.ts
│   ├── config/
│   │   ├── env.ts
│   │   └── load-env.ts
│   ├── routes/
│   │   └── auth.routes.ts
│   ├── middleware/
│   │   └── auth.middleware.ts
│   └── utils/
│       ├── jwt.util.ts
│       ├── password.util.ts
│       └── email.util.ts
├── Dockerfile
└── package.json
```

## Endpoints

Base path: `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | No | Register; sends generated password via email (or console in dev) |
| POST | `/login` | No | Login; rate limited to 5 requests/minute |
| POST | `/change-password` | JWT | Change password with current password verification |

### Request schemas

- **Register:** `{ fullName, age, phone, email }`
- **Login:** `{ email, password }`
- **Change password:** `{ currentPassword, newPassword }` (min 8 chars)

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | Yes | — | Min 32 characters |
| `PORT` | No | `3001` | Listen port |
| `NODE_ENV` | No | `development` | Environment |
| `SENDGRID_API_KEY` | No | — | SendGrid for password emails |
| `SENDGRID_FROM_EMAIL` | No | — | Sender email address |
| `REDIS_URL` | No | — | Optional (not used yet) |

## Dependencies

- `@datespot/database` — Prisma client
- `@datespot/utils` — `generateRandomPassword`
- `express-rate-limit` — login rate limiting
- `@sendgrid/mail` — transactional email (optional)

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Run `dist/index.js` |
| `pnpm lint` | Typecheck |

## Sync with monolith

Route logic is mirrored in [apps/api/src/routes/auth.routes.ts](../api/src/routes/auth.routes.ts) for local dev.

When changing auth behavior, update **both** this service and the monolith route file.

**Microservice-only feature:** login rate limiter (`5 req/min`) in `auth.routes.ts`. Not present in `apps/api`.

## When editing

- Use `verifyTokenMiddleware` for protected routes
- Password hashing via `bcrypt` in `utils/password.util.ts`
- JWT generation in `utils/jwt.util.ts`; payload includes `userId` and `isAdmin`
- Registration generates password with `@datespot/utils` and emails via `sendPasswordEmail`
