# Flowchart API

| Function | Route | Purpose |
| --- | --- | --- |
| `chat.ts` | `POST /api/chat` | In-app AI generation through Azure OpenAI. |
| `mcp.ts` | `POST /api/mcp` | Remote MCP server (Streamable HTTP, stateless) for AI agents. |
| `flows/index.ts` | `POST /api/flows` | Create a shared chart. |
| `flows/[id].ts` | `GET/PUT/PATCH /api/flows/:id` | Read, replace, or patch a shared chart. |

The MCP and flows functions are thin wrappers around `src/shared/server/http.ts`. The logic they share with the browser lives in `src/shared/`. Relative imports in that graph use explicit `.js` extensions because Vercel runs these files as native ES modules; `npm run typecheck:api` (part of `npm run build`) enforces this.

## `/api/mcp` and `/api/flows`

See [docs/mcp.md](../docs/mcp.md) for the tool reference, REST API, limits, and privacy model. In short:

- `POST /api/mcp` speaks MCP over Streamable HTTP in stateless mode: a new server and transport per request, with JSON responses. `GET` and `DELETE` return `405` because there is no SSE stream or session to end. CORS allows browser-based clients.
- `POST /api/flows` creates a chart and returns `{ id, version, url, editUrl, editToken, chart }`.
- `GET /api/flows/:id?since=<version>` returns `{ changed: false }` until a newer version exists, which keeps browser polling cheap (one Redis read; its rate limit is counted in memory).
- `PUT` and `PATCH /api/flows/:id` need `Authorization: Bearer <editToken>` and accept `baseVersion` for optimistic concurrency (`409` on conflict).

### Environment variables

- `KV_REST_API_URL` / `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis for chart storage and rate limiting. Required in production; chart operations return `503` without them.
- `PUBLIC_BASE_URL` (optional): origin used in returned links.
- `FLOW_TTL_DAYS`, `FLOW_RATE_LIMIT`, `FLOW_LIMIT_*`, `FLOW_BUDGET_*`, `FLOW_TRUST_PROXY`, `FLOW_STORE` (optional): see [docs/mcp.md](../docs/mcp.md#self-hosting) and [Capacity and costs](../docs/mcp.md#capacity-and-costs).

In local development (`npm run dev`), Vite mounts these same handlers and falls back to a file-backed store in the system temp directory when no Redis variables are set.

## `/api/chat`

`POST /api/chat` generates or refines a diagram through an operator-owned Azure deployment. Vercel and the Vite development server run the same handler in `src/shared/server/chat.ts`. The canvas works without AI configuration. An unconfigured AI request returns `503` with a message that canvas editing remains available.

### Routing configuration

All AI settings are server-side environment variables. `.env.example` contains placeholders only. Never put provider or gateway credentials in `VITE_*`, browser requests, repository files, or logs. A fork uses its own `/api/chat`, Azure resource, budget, and optional Cloudflare account.

| Setting | Behavior |
| --- | --- |
| `AI_ROUTING_MODE` | `disabled` by default. Set `direct` or `gateway` explicitly. |
| `AI_ENABLED=false` or `0` | Stops inference in either routing mode, including a pending structured-output retry. |
| `AI_REQUIRE_GATEWAY=true` or `1` | Rejects direct routing. Set this for the official website. |
| `AZURE_RESOURCE_NAME`, `AZURE_DEPLOYMENT_NAME`, `AZURE_API_KEY` | Your Azure resource, deployment alias, and key. Required in either enabled mode. |
| `AZURE_API_VERSION` | Defaults to `2024-10-21`. |
| `AZURE_MAX_COMPLETION_TOKENS` | Server-controlled completion limit, including reasoning tokens. Defaults to 4000, range 256 to 16000. |
| `AZURE_REASONING_EFFORT` | Optional `minimal`, `low`, `medium`, or `high`, only when supported by your deployment. Omitted by default. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_GATEWAY_ID`, `CLOUDFLARE_AI_GATEWAY_TOKEN` | Your account, gateway, and Run token. Required only in gateway mode. |
| `AI_INPUT_PRICE_PER_MILLION`, `AI_OUTPUT_PRICE_PER_MILLION` | Required positive USD prices per million tokens in either enabled mode. Used for cost estimates and Cloudflare custom pricing. |
| `AI_ADMISSION_COST_MULTIPLIER` | Conservative reservation multiplier, at least 1, default 2. Separate from reported cost estimates. |

Direct mode sends requests to `https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions`. It requires no Cloudflare account and retains all application limits. Gateway mode sends requests to `https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/azure-openai/<resource>/<deployment>/chat/completions`. Both use the configured API version. Gateway authentication, throttling, budget rejection, and outages never trigger a direct-provider fallback.

### GPT-6 Luna compatibility

Azure deployment names are operator-defined aliases. Verify the underlying model in Azure rather than inferring it from the alias. Issue #17 targets `gpt-6-luna`, version `2026-09-22`. On 2026-10-27, the configured Azure resource exposed that model with Chat Completions and Responses capabilities.

The compatible request uses system and user messages, `max_completion_tokens`, and strict `response_format.json_schema`. It omits `temperature` and `reasoning_effort` by default. The response includes the versioned model identifier, `finish_reason`, and prompt/completion usage. Only a narrowly identified unsupported `response_format` error permits one `json_object` retry through the same route. Each attempt needs a new admission allowance. Authentication failures, throttles, policy failures, outages, and timeouts have no application retry.

The [Microsoft Foundry announcement](https://azure.microsoft.com/en-us/blog/gpt-6-astra-sol-and-luna-for-production-agents-in-microsoft-foundry/) lists short-context Luna GlobalStandard prices of $0.10 input and $0.50 output per million tokens. Cache writes can cost more. Verify current prices for your region, SKU, caching, and contract before setting the variables. The default reservation multiplier supplies headroom; it does not change the actual-cost estimate sent to gateway telemetry. The application caps complete input JSON at 256 KiB, below the model's 272k-token long-context threshold even with its protocol allowance. Revisit both the cap and pricing if you change models.

### Application protections

| Setting | Default | Valid range or behavior |
| --- | --- | --- |
| `AI_CLIENT_REQUESTS_PER_MINUTE` | 6 | 1 to 1000 attempts per client network. |
| `AI_GLOBAL_REQUESTS_PER_MINUTE` | 30 | 1 to 10000 attempts across the environment. |
| `AI_DAILY_BUDGET_USD` | 5 | $0.001 to $10000 in reserved attempt cost. Resets at midnight UTC. |
| `AI_MAX_CONCURRENT` | 3 | 1 to 100 simultaneous attempts across the environment. |
| `AI_MAX_BODY_BYTES` | 131072 | 1024 to 262144 bytes of serialized request data. |
| `AI_MAX_INPUT_BYTES` | 163840 | 2048 to 262144 bytes, including system prompt, schema, messages, and context. |
| `AI_MAX_RESPONSE_BYTES` | 262144 | 1024 to 1048576 bytes of upstream response data. |
| `AI_TIMEOUT_MS` | 45000 | 1000 to 50000 milliseconds for admission, inference, response reading, and bounded retry together. |
| `AI_ADMISSION_STORE` | `redis` in production or Vercel; `memory` locally | Vercel refuses `memory`. Explicit memory is supported for a single-process self-host, with counters lost on restart. |
| `AI_ENVIRONMENT` | `VERCEL_ENV`, then `NODE_ENV`, then `development` | Namespace for shared counters and telemetry. Use distinct production, preview, and development values. |

Clients may send at most 20 user/assistant messages of 12000 characters each, 200 context nodes, and 400 context edges. The server validates types, IDs, finite geometry, and bounded fields. Clients cannot set system messages, output limits, provider configuration, prices, or gateway metadata. Embedded image payloads are excluded from browser AI context. Diagram content still travels to the selected provider and, in gateway mode, Cloudflare.

AI controls are independent of `FLOW_RATE_LIMIT` and fail closed. Production requires the `KV_REST_API_URL`/`KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` pair. Redis outages and malformed replies return unavailable before inference. A single atomic Lua operation checks the client rate, global rate, daily budget, and global concurrency lease. Rates use fixed minute windows, so requests around a boundary can form a two-window burst. The gateway supplies a separate sliding-window limit.

Each attempt permanently consumes a pessimistic allowance for that UTC day. Its input bound is the complete serialized request's UTF-8 byte length plus 1024 protocol tokens and 16 tokens per message. The output bound is `AZURE_MAX_COMPLETION_TOKENS`. The reservation is the resulting price estimate times `AI_ADMISSION_COST_MULTIPLIER`, rounded up to integer microdollars. It includes system prompt and structured schema overhead. Failed requests and structured-output retries consume allowances too. Cost is never refunded after an ambiguous timeout or process crash. Actual usage appears separately in telemetry.

Concurrency leases survive the UTC budget reset. A completed attempt releases only its unique lease. Interrupted or uncertain attempts retain the lease until expiry, which is twice the full request timeout plus 60 seconds. This conservative behavior can temporarily reject work after a provider/network failure. Changing environment names or Redis databases resets protection counters; treat that as an operational budget reset.

### Cloudflare gateway policies

Configure your own gateway before enabling public gateway traffic:

1. Enable authenticated gateway access. Use an account token with **AI Gateway Run** permission only. Cloudflare Run tokens are account-scoped and cannot currently be restricted to one gateway. Separate accounts provide stronger isolation. Store the token server-side.
2. Require your own provider credentials, with `byok_only=true`. Do not configure model fallback or Unified Billing fallback. Disable caching with `cache_ttl=0`; requests also send `cf-aig-skip-cache:true`.
3. Set an explicit sliding global rate limit and a blocking spend limit. A conservative official rollout can use 20 gateway attempts/minute, $5 per sliding day, a $4 application UTC-day allowance, and two concurrent attempts. These are operator policy choices, not account defaults.
4. Retain metadata/token/cost logs while suppressing prompts and completions. Requests send `cf-aig-collect-log-payload:false`, `cf-aig-max-attempts:1`, a bounded `cf-aig-request-timeout`, and server-created environment/request/operation metadata. Keep an application deadline because gateway retry/timeouts alone do not bound the last provider attempt.
5. Inspect Logpush independently. The payload-log request header does not control Logpush exports. Disable payload exports unless you deliberately need them and have an appropriate retention policy.
6. Verify the returned model, input/output token usage, nonzero estimated cost, status, and latency in gateway telemetry before public rollout. Requests send `cf-aig-custom-cost` with USD **per token**, converted from the operator's per-million settings. Missing provider usage prevents Cloudflare cost calculation.

Cloudflare spend enforcement is eventually consistent. It records costs after completion and can overshoot while requests are active or telemetry is delayed. The application has an atomic reserved-cost limit, but that limit depends on accurate prices and conservative token bounds. Neither setting promises an exact provider billing cap. Rate limits and concurrency reduce exposure; they do not establish a strict bound on Cloudflare telemetry delay.

For an input byte cap `B`, output token cap `T`, message count `M`, prices `Pi`/`Po` per million, and concurrency `N`, one full concurrent wave has a modeled cost at most `N * ((B + 1024 + 16*(M+1))*Pi + T*Po) / 1000000` before the reservation multiplier. Keep a margin above this estimate and account for additional waves during enforcement delay. Test observed gateway overshoot only against a separate low-budget test gateway with synthetic prompts. Application concurrency tests prove the Redis admission bound; they do not measure Cloudflare's eventual consistency.

An isolated operator test on October 27, 2026 set a $0.01 gateway spend threshold and launched two concurrent synthetic requests. Both completed, with $0.0200244 total reported cost. The next request two seconds later returned `429`. A separate invalid-token request returned `401`. This observation demonstrates overshoot under concurrency and successful later enforcement; it does not establish a maximum overshoot or enforcement-delay guarantee. Keep this probe on a separate gateway, never on production traffic.

New Cloudflare AI Gateway customers from September 24, 2026 use Workers Logs retention. Current defaults are three days on Free and seven days on Paid. Older gateways use legacy retention. Check your account's current retention and Logpush destinations; do not rely on the repository to enforce retention settings.

References: [Azure provider routing](https://developers.cloudflare.com/ai-gateway/usage/providers/azureopenai/), [gateway authentication](https://developers.cloudflare.com/ai-gateway/configuration/authentication/), [rate limits](https://developers.cloudflare.com/ai-gateway/features/rate-limiting/), [spend limits](https://developers.cloudflare.com/ai-gateway/features/spend-limits/), [custom costs](https://developers.cloudflare.com/ai-gateway/configuration/custom-costs/), [payload logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), and [request handling](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/).

### Requests and responses

```json
{
  "messages": [{ "role": "user", "content": "Add a retry step" }],
  "diagramMode": "flowchart",
  "mode": "refine",
  "flowContext": {
    "nodes": [{ "id": "start", "type": "step", "label": "Start", "position": { "x": 0, "y": 0 } }],
    "edges": []
  }
}
```

`diagramMode` is `flowchart` or `architecture`; `mode` is `generate` or `refine`. Both default to their first value. Refinement requires context and preserves unchanged IDs, nesting, image URLs, and edge metadata. Successful responses contain `{ message, role: "assistant", finishReason }`; `message` is raw JSON with `summary`, `nodes`, and `edges`. The browser previews the proposal before insertion. Truncated, malformed, or invalid-reference diagrams return a safe error instead of an incomplete proposal.

Errors use `{ error, code }`. `400` rejects malformed requests, `405` rejects other methods, `413` rejects excessive input, `429` reports application or gateway limits, `502` reports invalid provider output, `503` reports disabled/unconfigured/unavailable AI, and `504` reports the request deadline. `Retry-After` accompanies rate-limit responses. Generation and refinement display the server's safe feedback without automatic retries.

### Operations and verification

Set `AI_ENABLED=false` to disable application inference, then redeploy or restart instances that cache environment variables. To stop traffic immediately while deployment propagates, disable gateway access or set its blocking policy to zero. The application checks the kill switch before admission and before every upstream attempt. Gateways and Azure deployment policies remain the independent emergency stop for already-running calls.

The handler emits one structured `ai_request` event per request. It includes environment, routing, request ID, model when supplied, request outcome/status, attempts, duration, token counts, estimated actual cost, reserved attempt cost, and whether usage was reported. It does not log prompts, responses, provider error payloads, IP addresses, or credentials. Monitor non-success outcomes, `429` volume, absent usage, unexpected models, and reserved-versus-actual cost. Inspect provider logs and hosting log retention separately.

Keep production and preview credentials, gateways, counters, and budgets separate. Preview deployments must not inherit the maintainer's production AI budget. Do not enable direct mode as an outage workaround on the official site. A deliberate self-hosted direct deployment is supported.

Before rollout, verify a credential-free local canvas and its unconfigured-AI message; direct mode with your own credentials; gateway mode with authenticated telemetry; both diagram modes; existing context; refinement; preview; and insertion. Check invalid gateway credentials, `429`, budget exhaustion before retry, Redis failure, the kill switch, and timeout feedback. Confirm no provider/gateway secrets appear in browser bundles or logs.

Run `npm test -- --run` and `npm run build`. The optional real Redis admission tests run with `AI_TEST_REDIS_URL=redis://127.0.0.1:16389 npm test -- --run src/test/server/aiAdmission.test.ts`. They use randomized test namespaces and expiring keys. Run them against a disposable local Redis instance. They test concurrent admission, permanent budget charging, unique lease release, lease expiry, and corrupt-state rejection.
