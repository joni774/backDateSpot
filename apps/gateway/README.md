# API Gateway (`gateway`)

nginx reverse proxy that exposes a single external port for the Docker microservices stack.

No application code — routing is configured in `nginx.conf`.

## Role

- Single external entry point on port **3000**
- Route `/api/auth`, `/api/places`, `/api/admin` to the correct upstream service
- Provide a lightweight `/health` endpoint for Docker healthchecks
- Forward `X-Request-ID` for request tracing

## Port / path

| External | Internal |
|----------|----------|
| `http://localhost:3000` | nginx on port 80 |
| `GET /health` | Returns `{"status":"ok"}` (gateway stub, not proxied) |

## Routing table

From [nginx.conf](nginx.conf):

| Location | Upstream | Service port |
|----------|----------|--------------|
| `/api/auth` | `auth-service` | 3001 |
| `/api/places` | `places-service` | 3002 |
| `/api/admin` | `admin-service` | 3003 |
| `/` | 404 JSON | — |

Proxy headers set on all upstream requests: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `X-Request-ID`.

## Directory structure

```
apps/gateway/
├── nginx.conf      # Routing configuration
├── Dockerfile      # nginx image
└── README.md
```

## Environment

The gateway itself has no environment variables. Upstream services receive their env from [docker-compose.yml](../../docker-compose.yml).

## Dependencies

Depends on healthy upstream services (Docker `depends_on` with healthchecks):

- `auth-service`
- `places-service`
- `admin-service`

## When editing

- Add new upstream blocks in `nginx.conf` for new services
- Keep path prefixes aligned with each service's Express mount point (`/api/{domain}`)
- Do not expose internal service ports directly — only the gateway should be published
- `/health` on the gateway is independent of service health; use individual service healthchecks in compose

## Related docs

- [docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) — full request flow diagram
- [docker-compose.yml](../../docker-compose.yml) — service definitions and networking
