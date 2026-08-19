# AI Service (`ai-service`)

LLM-backed DateSpot AI chat with 3-layer security (pre-filter, hardened system
prompt + `search_places` tool, post-filter).

In Docker microservices mode, exposed as `/api/ai` via the [gateway](../gateway/README.md).
Port **3004** is internal only.

## Endpoints

Base path: `/api/ai`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/quota` | JWT | Daily AI quota |
| GET | `/sessions` | JWT | Recent sessions |
| GET | `/sessions/:id` | JWT | Session + messages |
| POST | `/chat` | JWT | Chat turn (3-layer pipeline) |

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL |
| `JWT_SECRET` | Yes | — | Min 32 characters |
| `PORT` | No | `3004` | Listen port |
| `REDIS_URL` | No | — | Rate limiting when set |
| `OPENAI_API_KEY` | No* | — | Enables LLM path; without it, keyword + fallback only |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Main agent model |
| `OPENAI_CLASSIFIER_MODEL` | No | `gpt-4o-mini` | Layer 1 classifier |
| `PUBLIC_API_URL` | No | — | Absolute URL for place image links |

\* Required for full LLM recommendations in production.

## Sync with monolith

Route logic lives in `@datespot/ai-logic` (`createAiRouter`). Both this service and
`apps/api` mount the same factory.

See [docs/AI_AGENT_SECURITY_POLICY.md](../../docs/AI_AGENT_SECURITY_POLICY.md).
