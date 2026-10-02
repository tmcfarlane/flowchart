# Flowchart AI MCP v2.1

Flowchart AI's remote MCP validates, lays out and stores charts designed by an AI agent. It does not call an LLM. Production URL: `https://flowchart.zeroclickdev.ai/api/mcp`. This change must be reviewed and deployed before the v2 plugin is connected to that URL.

## Create and revise

Before saving, consent to link sharing: anyone with the view link can read the diagram, and anyone with its private edit link can edit or delete it. Charts have no account ownership and are retained indefinitely unless server retention is configured or an edit-link holder deletes them. Do not put confidential information in link-shared charts.

The agent calls `create_flowchart` with `sharing: "link-shared"`, `title`, `nodes`, `edges` and optional `direction: "TB" | "LR"`. It returns a view URL. In an MCP Apps host the private chart card opens the existing browser editor or offers confirmed deletion. The edit capability is delivered only in result metadata to the card. In hosts without UI, only view access is available; never paste an edit link into chat to compensate.

Browser edits made with a private edit link save automatically with version checks and live sync. A conversational revision reads the latest chart by id and creates a new copy with consent. The original remains available. `update_flowchart` is removed from MCP v2: edit tokens must not be model-visible arguments or results. The token-authorized REST API continues to support existing browser editing.

Visitors with a view link can choose **Make editable copy** in the browser. This retains their current canvas, stops syncing with the source, and opens a local diagram without writing to the original. Existing browser drafts are reviewed before replacement and can be downloaded as importable diagrams; unverifiable data remains available as a raw salvage backup. Sharing the new copy requires a separate explicit share action. Artwork with private access URLs cannot be saved in a safe browser draft, so the editor keeps it on the canvas and explains how to preserve it by export.

## Portable plugin

See [ChatGPT plugin implementation and review requirements](chatgpt-plugin.md). `plugins/flowchart-ai/` contains the manifest, remote MCP config and authoring skill. A repo marketplace exposes the development package. This is not a directory-approved release. Anonymous creation eligibility and the actual ChatGPT staging UI flow still require review.

For local development, run `npm ci` and `npm run dev`; use `http://localhost:3004/api/mcp` in a scratch copy of the plugin's `mcp.json`. Local charts use a file in the system temp directory, preserving charts across restarts. Remote hosts need a reachable HTTPS staging endpoint. No account or inference key is needed for the development tools. Per-tool metadata explicitly declares `noauth`; this does not guarantee public directory acceptance for anonymous writes.

## Tools and schemas

| Tool | Input | Output / behavior |
| --- | --- | --- |
| create_flowchart | sharing (`link-shared`), title, nodes, optional edges/direction | id, version, title, view url, sharing, retention, counts, layout. Private UI metadata holds edit access. Each retry creates a new chart. |
| get_flowchart | id (10 letters/digits only) | Latest chart and view URL, including browser edits. Read-only. Do not send URLs or tokens. |
| list_node_types | none | Fixed node vocabulary, default sizes, container/edge vocabulary and limits. |
| search_azure_icons | query, optional limit/category | Icon ids/names from the bundled Azure catalog. |
| search_icons | query, optional limit/category/provider | Stable ids for the unified local catalog: Azure services and 65 original illustrations across ten categories. No web search or remote images. |
| list_diagram_templates | optional query/category | Summaries for 20 curated process, business, cloud and creative starting points. Does not create charts. |
| get_diagram_template | id | Editable draft with title, nodes, edges and direction. Does not save or share it. |
| audit_diagram | nodes, optional edges | Deterministic validation and actionable design feedback. Returns normalized nodes/edges when valid. Does not save charts, fetch images or call a model. |

Nodes use `{ id, type, label, position?, width?, height?, icon?, imageUrl?, parentNode?, containerKind? }`. Types: step, decision, note, image, service, database, queue, cache, apiGateway, externalActor, container. Omit positions for automatic layout. Container children reference their parent's id; nested positions are relative to that parent.

Edges use `{ source, target, id?, label?, style?, sourceHandle?, targetHandle?, protocol?, commStyle? }`. Label decision branches. `flowchart://guide` supplies design rules/examples; `flowchart://schema` supplies JSON schemas. `design_flowchart` supplies the authoring prompt. `ui://flowchart-ai/chart-card-v3.html` is the generic preview/private-controls UI resource and contains no chart capabilities.

The created-chart card receives the public rendering subset in widget-only `_meta["flowchart/chart"]` and edit access in `_meta["flowchart/private"]`. Model-visible results keep the view URL, title and counts without duplicating diagram arrays. The responsive local SVG preview draws shapes, labels and connections, translates nested positions, and provides zoom controls. It shows at most 60 nodes and 120 connections; larger diagrams explain the cap and direct the user to the full browser editor. The card never loads external image URLs or icon assets; illustrations use type glyphs. Resource CSP remains restricted to direct API connections at the exact server origin, with no remote resources or embedded frames.

`flowchart://templates` supplies the template summaries. `get_diagram_template` returns an independent editable copy; adapt it to the user's actual needs before saving. Practical templates cover onboarding, incidents, releases, checkout, subscription lifecycles, product discovery and cloud architecture. Creative templates include Dream Observatory, Memory Garden, Story Engine, Ideas in Orbit and Tiny Adventure. Those are imaginative prompts, not factual descriptions of real systems.

The browser gallery and `list_diagram_templates` use the same search rule: every query word must match somewhere in the template ID, title, description, category or node labels. Case and punctuation are normalized, and words can match different fields. Empty or punctuation-only searches return the category's catalog; unknown words return no matches. The MCP query remains limited to 200 characters.

`audit_diagram` reports errors for malformed nodes, missing references, invalid icons and nesting. Non-blocking suggestions flag unlabeled or incomplete decisions, repeated outcome labels, isolated nodes, empty containers, long labels and external image hosts. It accepts deliberate loops and unattached context notes. It checks structure and readability; it does not verify the factual content of a diagram. Its normalized draft uses canonical icon and generated edge ids, allowing callers to fix problems before a create. The local catalog and audit helpers remain usable when chart storage is unavailable.

Stable original icon ids such as `icon-user`, `icon-credit-card`, `icon-robot`, `icon-crystal` and `icon-portal` are resolved through a fixed build-time allowlist. The browser maps these ids to bundled SVG URLs and serializes them back to stable ids, just as it does for existing Azure icons. Icon resolution never interprets a user value as a filesystem path or downloads an image.

Limits: 500 nodes, 1,000 edges, 200 browser operations, 500-character labels, 200-character titles, 256 KB body/stored chart. Invalid shape or semantics produces an all-or-nothing validation error with locations.

## REST API and deletion

| Request | Purpose |
| --- | --- |
| POST /api/flows | Create a chart for a direct browser/integration; returns its chart and edit capability. This API is not an MCP tool; don't proxy its secret results into model context. |
| GET /api/flows/:id | Read; `?since=<version>` checks cheaply for updates. |
| PUT /api/flows/:id | Replace; send Authorization: Bearer editToken and baseVersion. |
| PATCH /api/flows/:id | Apply operations with the edit bearer and optional baseVersion. |
| DELETE /api/flows/:id | Permanently remove the record with the edit bearer. Reads, polls and stale writes subsequently fail. |

Deletion is available through the private card and the browser Share panel. Only the edit capability authorizes it. No account library, ownership claim, token recovery or model-callable delete tool exists. Deleting cannot erase downloaded copies or material already in chat. Tokens are SHA-256 hashed in storage; browser capabilities are stored in site localStorage and removed from the address bar. View links grant reading, not writes.

External image nodes can make browsers contact their image hosts. Prefer bundled local icons or plain nodes; arbitrary images may disclose visitor IPs to their host.

## Hosting

Vercel functions use the same handlers as Vite. Production requires Upstash Redis; missing storage produces a 503 rather than silently losing charts. Configure `KV_REST_API_URL` / `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. `PUBLIC_BASE_URL` supplies the public origin.

`FLOW_TTL_DAYS` optionally expires Redis records after inactivity, refreshing on writes. Unset means indefinite retention. It does not affect dev memory/file stores or retroactively expire untouched existing Redis records. Existing records support capability-authorized deletion after this change.

Rate limits and shared storage/work budgets remain in place. Defaults: MCP creates 300/hour per IP, MCP messages 1,200/minute per IP, browser creates 30/10 minutes, writes 120/minute, reads 600/minute, polls 1,200/minute. Shared daily budgets: 5,000 creation units, 50,000 write units, 50 MB growth. Large automatic layouts consume more work units. Errors include retry guidance, and REST responses use Retry-After. Cloud agents share provider IPs.

Operator settings: `FLOW_RATE_LIMIT=off`; `FLOW_LIMIT_MCP_CREATE`, `FLOW_LIMIT_MCP_WRITE`, `FLOW_LIMIT_CREATE`, `FLOW_LIMIT_WRITE`, `FLOW_LIMIT_READ`, `FLOW_LIMIT_POLL`, `FLOW_LIMIT_MCP`; `FLOW_BUDGET_CREATES`, `FLOW_BUDGET_WRITES`, `FLOW_BUDGET_STORAGE`. Limits use count/window (`600/1m`, `5000/1d`, `50mb/1d`) or `off`. Set `FLOW_TRUST_PROXY=1` only behind your own header-setting proxy; Vercel forwarding is trusted automatically. `FLOW_STORE=memory` is an explicit production fallback for one long-running process. Budget/rate checks retain the existing fail-open behavior if Redis is unavailable; review operational abuse controls before a public launch.

`npm test -- --run` verifies storage/schema/layout/HTTP/MCP/UI/editor behavior. `npm run build` also checks API and frontend types. On Node 25 with the current jsdom/Vitest, disable experimental Node webstorage for tests (`NODE_OPTIONS=--no-experimental-webstorage`).
