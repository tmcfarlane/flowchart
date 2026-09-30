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

Vercel Serverless Function that proxies AI requests to Azure OpenAI (or compatible endpoint).

### Environment Variables

Server-side environment variables (NOT `VITE_*`):

- `AZURE_DEPLOYMENT_NAME` - Azure OpenAI deployment name
- `AZURE_RESOURCE_NAME` - Azure OpenAI resource name
- `AZURE_API_KEY` - Azure OpenAI API key

### Request Format

```typescript
POST /api/chat

{
  "messages": [
    { "role": "user", "content": "Create a login flow" }
  ],
  "flowContext": {
    "nodes": [...],  // Current flowchart nodes
    "edges": [...]   // Current flowchart edges
  }
}
```

### Response Format

```typescript
{
  "message": "```json\n{...}\n```",
  "role": "assistant"
}
```

The `message` field contains a JSON code block with the flowchart proposal.

### Flowchart Generation Skill

The API uses a **skill-based prompt engineering approach** defined in `flowchart-generation-skill.md`.

This skill file:
- Defines the exact JSON schema the AI must use
- Provides multiple correct/wrong examples
- Enforces strict flowchart-only output
- Is loaded at runtime and sent as the system prompt

**To modify AI behavior:** Edit `flowchart-generation-skill.md`, not `chat.ts`.

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
    → Frontend parses JSON → Shows preview → Inserts on confirm
```

### Error Handling

- **400** - Invalid request (missing messages)
- **405** - Method not allowed (non-POST)
- **500** - Server configuration error or Azure OpenAI API error
- **200** - Success (includes assistant message)
