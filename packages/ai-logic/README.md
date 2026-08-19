# `@datespot/ai-logic`

Shared DateSpot AI chat logic: 3-layer security (pre-filter → LLM agent → post-filter),
OpenAI client, `search_places` tool, quota/sessions routes.

Used by:

- `apps/api` (monolith)
- `apps/ai-service` (microservice)

See [docs/AI_AGENT_SECURITY_POLICY.md](../../docs/AI_AGENT_SECURITY_POLICY.md).
