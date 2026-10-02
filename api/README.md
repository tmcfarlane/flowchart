# Flowchart API

| Function | Route | Purpose |
| --- | --- | --- |
| `chat.ts` | `POST /api/chat` | Diagram generation and complete-graph editing through Azure OpenAI. |
| `mcp.ts` | `POST /api/mcp` | Remote MCP server (Streamable HTTP, stateless) for AI agents. |
| `flows/index.ts` | `POST /api/flows` | Create a shared chart. |
| `flows/[id].ts` | `GET/PUT/PATCH/DELETE /api/flows/:id` | Read, replace, patch or delete a shared chart. |
| `billing/*.ts` | `/api/billing/session`, `/checkout`, `/portal`, `/recovery`, `/restore`, `/webhook` | Verified subscription state, hosted Stripe billing, private browser recovery and signed payment events. |
| `images.ts` | `POST /api/images` | Reserve paid allowance and generate one durable image. |
| `images/[id].ts` | `GET/HEAD/OPTIONS/DELETE /api/images/:id` | Capability-protected asset reads and owner-only deletion. |

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

Vercel Serverless Function that sends validated diagram requests to the configured Azure OpenAI deployment. The same handler serves local development.

### Environment Variables

Server-side environment variables (NOT `VITE_*`):

- `AZURE_DEPLOYMENT_NAME` - Azure OpenAI deployment name
- `AZURE_RESOURCE_NAME` - Azure OpenAI resource name
- `AZURE_API_KEY` - Azure OpenAI API key

Production also requires a fixed `PUBLIC_BASE_URL` website origin and shared Redis capacity storage. Per-client attempts, global daily budget, concurrent requests, request/reply sizes and duration are bounded. See [diagram AI configuration](../docs/diagramAI.md).

### Request Format

```typescript
POST /api/chat

{
  "messages": [
    { "role": "user", "content": "Create a login flow" }
  ],
  "mode": "generate", // Use "refine" for a complete-graph edit
  "diagramMode": "flowchart", // Or "architecture"
  "flowContext": {
    "nodes": [...],  // Current flowchart nodes
    "edges": [...]   // Current flowchart edges
  }
}
```

### Response Format

```typescript
{
  "message": "<normalized diagram JSON>",
  "role": "assistant",
  "finishReason": "stop"
}
```

The `message` field contains a validated JSON diagram proposal. The website presents it for insertion or application, and prevents an edit from replacing a canvas that changed during the request. Binary uploads stay in the browser and are restored for compatible matching nodes.

### Flowchart Generation Skill

The API uses a **skill-based prompt engineering approach** defined in `flowchart-generation-skill.md`.

This skill file:
- Defines the exact JSON schema the AI must use
- Provides multiple correct/wrong examples
- Enforces strict flowchart-only output
- Is loaded at runtime and sent as the system prompt

The handler adds the complete node/icon/container vocabulary, diagram context and edit-preservation instructions from `chat.ts`. Update the generation reference and those additions together when changing AI behavior. Both server and browser normalize replies against the shared diagram contract.

### Architecture

```
User Input → Frontend (AIChat.tsx)
    ↓
    → POST /api/chat (with flowContext)
    ↓
    → Loads flowchart-generation-skill.md
    ↓
    → Azure OpenAI API (with skill as system prompt)
    ↓
    → Returns flowchart JSON
    ↓
    → Frontend validates JSON → Shows preview → Inserts or applies on confirm
```

### Error Handling

- **400** - Invalid request or diagram context
- **403** - Invalid website origin
- **413** - Excessive request size
- **415** - Unsupported media type
- **405** - Method not allowed (non-POST)
- **429** - Capacity or provider rate limit
- **502** - Invalid or failed provider reply
- **503** - Missing provider or shared production capacity
- **504** - Provider timeout
- **500** - Internal request setup failure
- **200** - Success (includes assistant message)

Only an explicit unsupported structured-output format triggers one JSON-object fallback. Authentication, network, timeout, rate-limit and provider-server failures are not retried automatically. Replies use no-store headers and exclude credentials and raw provider diagnostics.

## ChatGPT allowance and Premium images

Website chat currently uses the operator's Azure budget. Using each user's own ChatGPT allowance is a separate, unenabled integration requiring approved hosted provisioning and plan-usage consent. Arbitrary consumer tokens are not accepted. See [ChatGPT plan usage](../docs/chatgpt-plan-usage.md).

Premium images use a separately configured OpenAI Images API project. Checkout success URLs and browser-paid flags do not grant access: the backend verifies Stripe customer/price ownership, positive paid invoices and current subscription/risk state before reserving image quota. Signed webhooks, proof revisions and account reservations coordinate cancellation and payment holds. Follow [Premium configuration, endpoint contracts and verification](../docs/premium.md). Missing configuration reports unavailability without fabricating access or generated output.
