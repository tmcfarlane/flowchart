# Diagram assistant requests and cost controls

The website's assistant uses the configured server-side Azure OpenAI deployment to propose complete diagrams or edits. The user reviews a proposal before applying it. AI replies are normalized against supported nodes, connections, container hierarchy and diagram limits on both the server and browser; invalid, truncated or unreadable replies leave the canvas unchanged.

This route currently uses the operator's Azure AI budget. Sign in with ChatGPT identity and permission to use a person's ChatGPT AI allowance are separate integrations and are not implemented here. The server does not accept arbitrary ChatGPT access tokens, cookies or consumer browser sessions as inference credentials. The deterministic MCP tools remain separate from this website AI route.

## Requests

`POST /api/chat` accepts JSON:

```json
{
  "messages": [{ "role": "user", "content": "Add a review step after approval" }],
  "mode": "refine",
  "diagramMode": "flowchart",
  "flowContext": {
    "nodes": [{ "id": "approval", "type": "step", "label": "Approval", "position": { "x": 0, "y": 0 } }],
    "edges": []
  },
  "selectedNodeIds": ["approval"]
}
```

Conversation history contains 1–20 user/assistant messages, each with non-empty text up to 10,000 characters. Client-supplied system messages are rejected. The final message must be a user request. A refinement requires a valid current diagram; invalid connection targets, duplicate IDs or container references are rejected before provider spend. Selected IDs are limited to existing nodes. Both the parsed request and adapter's raw request bytes are bounded. Uploaded binary image data is omitted from the browser's AI context, and preserved image data is restored for unchanged node IDs when applying the edit.

The server adds its own generation instructions and supports every registered shape, architecture icon references, containers, connection protocols and communication styles. Generation produces a new standalone diagram for insertion; refinement returns the complete diagram while preserving unrequested portions. The browser presents the change for review.

The route first requests the structured JSON schema. Only an explicit provider `response_format`/`json_schema` unsupported error triggers one fallback to JSON object output. Network failures, timeouts, authentication errors, provider 5xx responses and rate limits are never retried automatically. Every successful reply is validated regardless of format.

## Capacity and spend limits

The anonymous website endpoint has independent capacity controls, separate from MCP/chart storage limits. A request reserves shared capacity before making a provider call. Default limits are:

- Six requests per client per minute.
- Forty requests per client per hour.
- Three hundred requests globally per UTC day.
- Two concurrent requests per client and ten globally.

Rejected requests do not consume another provider attempt. Provider failures still count as attempts, so automatic retry loops cannot spend without bounds. Concurrent requests hold expiring leases; completion or failure releases them. A disconnected browser aborts its provider request. An abandoned lease expires after 120 seconds, and the provider request times out after 90 seconds. Responses are bounded while streaming, including responses with no Content-Length. No more than 1.5 MB of upstream JSON is accepted.

Production uses atomic Redis scripts across serverless instances and fails closed when shared capacity is missing or unavailable. Local development uses in-process counters. Client identities use IPv4 addresses or an IPv6 /64 network, hashed before storage. Proxy IP headers are accepted using the same trusted-proxy rules as the chart API. Never trust a client-supplied premium flag or account ID to bypass these limits.

| Server variable | Purpose |
| --- | --- |
| `AZURE_RESOURCE_NAME` | Azure OpenAI resource name, validated before constructing the endpoint. |
| `AZURE_DEPLOYMENT_NAME` | Deployment name, encoded as one URL path component. |
| `AZURE_API_KEY` | Server-side Azure API secret. Never use a `VITE_` prefix. |
| `PUBLIC_BASE_URL` | Fixed HTTPS website origin (localhost HTTP allowed for development). When configured, cross-origin requests are rejected; production also requires a matching Origin header. |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Shared production Redis, or the equivalent `UPSTASH_REDIS_REST_*` pair. |
| `CHAT_LIMIT_PER_MINUTE` | Default 6, maximum 1,000. |
| `CHAT_LIMIT_PER_HOUR` | Default 40, maximum 10,000. |
| `CHAT_BUDGET_PER_DAY` | Default 300 global requests, maximum 100,000. |
| `CHAT_IN_FLIGHT_PER_CLIENT` | Default 2, maximum 100. |
| `CHAT_IN_FLIGHT_GLOBAL` | Default 10, maximum 1,000. |

These are request capacity caps, not exact dollar budgets. Configure the provider project's spend cap and deployment/token limits as well. Changing these limits or increasing the maximum output token count changes possible cost; choose settings deliberately. Invalid/non-positive capacity configuration falls back to safe defaults instead of disabling protection.

## Errors and verification

Malformed JSON and invalid context return 400; wrong media type 415; oversized requests 413; wrong website origin 403; exhausted capacity/provider rate limits 429 with bounded Retry-After; missing provider/shared capacity 503; invalid or failed provider responses 502; and timeouts 504. User responses contain helpful recovery text without upstream credentials, prompts, account diagnostics or raw exceptions. Replies use no-store and nosniff headers.

`src/test/server/chat.test.ts` exercises real Node HTTP requests through the same request adapter as Vite. It checks validation before provider calls, schema fallback boundaries, secret scrubbing, context/selection forwarding, malformed/oversized input, production origin and capacity gates, bounded streaming output, timeout/disconnect cleanup, fixed-window budgets and expiring concurrent leases. The provider is a fixture, so these tests prove the application contract rather than actual model behavior. Separately verify genuine AI generation and refinement against the configured deployment before release, including proposal review and keeping unchanged canvas content intact.
