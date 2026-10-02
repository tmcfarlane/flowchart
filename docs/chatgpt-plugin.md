# Flowchart AI ChatGPT plugin MVP

Development implementation, September 30–October 2, 2026. No deployment or directory submission is performed by this change. The production endpoint still needs this reviewed server version before this package can be used safely.

## User flow

Explain link sharing and retention → user consents → ChatGPT designs nodes and edges → `create_flowchart` with `sharing: "link-shared"` → view URL in chat and private MCP Apps card → open existing browser editor or confirm deletion. A later conversational change reads the latest chart by id and creates a revised copy, preserving the original.

The tools perform validation, layout, icon resolution and storage. They do not call an LLM. Installing this plugin does not change the Azure AI proxy, its billing, or the web editor's inference provider. Sign in with ChatGPT identity and hosted plan usage remain a separate phase, subject to their access requirements.

## Package and local testing

`plugins/flowchart-ai/` contains a portable root manifest, Streamable HTTP configuration, and the focused diagram-authoring skill. `.agents/plugins/marketplace.json` exposes it to local marketplace discovery. This change does not install it into the user's global configuration.

1. `npm ci`, then `npm run dev` (default port 3004). Local charts use the development file store.
2. Copy the plugin folder into a scratch marketplace and set its `mcp.json` URL to `http://localhost:3004/api/mcp` for a local client. The packaged production URL must only be used after deploying MCP v2.
3. For ChatGPT developer mode, use a reachable HTTPS staging server, register its actual technical id, and map that id into the package if needed by the host. No technical id is invented in this package.
4. Ask for a diagram, consent to the disclosed link-sharing scope, open its card, edit in the browser, request a revision, then delete the sample charts.

`npm test -- --run` covers server, storage, HTTP, bridge, renderer/editor and live-sync behavior. On Node 25, the old Vitest/jsdom combination can inherit Node's experimental localStorage instead of jsdom's implementation; use `NODE_OPTIONS=--no-experimental-webstorage npm test -- --run`, or Node 22. `npm run build` builds the app and checks frontend/API types. `npm run plugin:ui` bundles the MCP Apps card, with console calls removed. The generated bundle is committed so API builds can load it without a frontend build at runtime. It is regenerated before dev/build/test.

## Capability and channel boundaries

- MCP `content` and `structuredContent` contain only view URL, id, title, counts, layout and sharing/retention information. The chart id grants link-based reading; it is deliberately public to holders.
- Only the `create_flowchart` result's `_meta["flowchart/private"]` contains the browser edit URL and edit token. Public rendering fields travel separately in widget-only `_meta["flowchart/chart"]`; external image URLs, icon paths and stored timestamps are omitted. The linked `ui://flowchart-ai/chart-card-v3.html` resource uses `text/html;profile=mcp-app`. The resource is a generic template; reading it yields no token.
- The card renders a responsive SVG preview using DOM shape construction and `textContent`, never HTML from chart labels. It draws at most 60 nodes and 120 connections, resolves nested coordinates, and explains capped or unavailable previews. Type glyphs stand in for image artwork; there are no external asset fetches. Opening links awaits the MCP Apps bridge response. A result delivered while an earlier delete is in flight is not cleared by that older request's completion.
- The card uses the actual MCP Apps SDK bridge: `ui/initialize`, `ui/notifications/tool-result`, and `ui/open-link`. It accepts private result metadata, restricts destinations to the server origin and exact chart URL, and opens the editor through the host. It does not put the capability in widget state, model context, follow-up messages or MCP tool arguments. SDK console logging is removed during bundling.
- Card deletion uses a direct, credential-free cross-origin REST request with the capability in the Authorization header. Its CSP declares only the exact API origin in `connectDomains` and no remote resource origins. There are no nested frames or third-party assets in the card.
- Browser edit capability is held by the existing editor in site localStorage after removing the URL fragment. It authenticates version-checked REST writes. This is link-based authorization, not account ownership or OAuth.
- `DELETE /api/flows/:id` checks the token hash and deletes atomically in storage. File deletion is persisted; Redis deletion removes its full hash. A stale save cannot recreate a deleted record. The card and browser require an explicit deletion click after confirmation.
- No existing-chart MCP writes or deletion tools are exposed. `get_flowchart` accepts a strict chart id, not a URL that might contain an edit token. Conversation/session metadata is not used for authorization.

A host without MCP Apps UI can still create/read charts and return view links, but cannot deliver recoverable edit access. Do not expose the private capability to compensate. A lost capability has no recovery mechanism. The local bridge tests validate the actual bundled card against a simulated host, the HTTP tests validate the real server transport, and a Chromium run validated the card in an opaque-origin iframe with a restrictive CSP, browser editor opening, persisted browser edits, and direct card/browser deletion; a real ChatGPT staging installation still needs to confirm host-specific `_meta` delivery, link opening, CSP enforcement and remount behavior.

## Sharing, retention and deletion

Charts are readable by anyone with the view link. Anyone with the private edit link can edit or permanently delete the stored chart. There are no accounts or ownership checks. Do not use this prototype for confidential diagrams. Disclosure appears in the tool description, skill, result, card, browser Share panel and policy drafts.

Existing and new charts retain the existing indefinite policy by default. `FLOW_TTL_DAYS` optionally expires Redis records after that period without writes; it is refreshed on updates, does not apply to the memory/file development stores, and does not retroactively expire untouched old records. The new deletion path works for existing records with the existing edit capability. Clearing a canvas is no longer the only content-removal option. Lost edit access remains unrecoverable. Deletion cannot erase screenshots, exports, downloaded copies or chart content already in chat; hosting-provider backup/log retention must be reviewed separately.

## Annotations and anonymous eligibility

| Tool | readOnlyHint | destructiveHint | openWorldHint | idempotentHint | Reason |
| --- | --- | --- | --- | --- | --- |
| create_flowchart | false | false | true | false | Adds a link-shared artifact; each retry creates another chart. |
| get_flowchart | true | false | true | true | Reads arbitrary link-shared chart ids; no bounded private account. |
| list_node_types | true | false | false | true | Reads a fixed local vocabulary. |
| search_azure_icons | true | false | false | true | Searches a fixed bundled catalog, not the web. |
| search_icons | true | false | false | true | Searches fixed local Azure and original SVG icon metadata. |
| list_diagram_templates | true | false | false | true | Reads local curated template summaries. |
| get_diagram_template | true | false | false | true | Returns an editable local draft without saving it. |
| audit_diagram | true | false | false | true | Computes structural and readability feedback without saving, fetching images or making AI requests. |

All tools explicitly declare `noauth` in the documented compatibility `securitySchemes` metadata. An explicit sharing argument and host write approval are consent controls, not authentication. The server cannot independently prove that the user saw a disclosure. OpenAI's current authentication guide recommends authentication for write actions; it does not establish an exception guaranteeing anonymous chart creation will pass directory review. Treat this package as a developer-mode prototype pending an eligibility decision. If authentication is required, implement MCP OAuth and server-side audience/scope validation before public submission, without pretending a conversation id supplies authorization.

## Review cases

Positive cases (run with disposable, non-sensitive data):

1. Signup with a verified-email Yes/No branch: create and read; labels and edges survive layout.
2. Azure architecture: search Cosmos/Entra icons, group nodes in a container, create LR layout.
   Also browse the unified `search_icons` catalog and create a diagram with original `icon-*` illustrations.
   Retrieve a template and audit it before creating; verify reads/audits have no storage side effects and remain available without storage.
3. Open browser editor using private result metadata: change a label, reload, read latest through MCP.
4. Revise that chart as a new copy: include browser changes and confirm original id/version/content remain.
5. Confirm deletion through the card or browser: view/read/poll fail and an old authorized save cannot restore the chart.

Negative cases:

1. Omitted sharing mode/private mode: creation errors without persisting or returning a capability.
2. Invalid node type/icon/dangling edge: report validation locations and reject the whole chart.
3. Wrong, missing or another chart's edit capability: deletion denied; original chart remains readable.
4. Missing private metadata or malicious destination: private card controls stay disabled, with no capability fallback to chat.
5. Rate/storage failure: actionable error without claiming a saved chart; unknown create outcome must not be blindly retried.

## Before public release

- Review anonymous write eligibility with the submission portal/OpenAI; implement MCP OAuth if required.
- Deploy this version to HTTPS staging and complete a real ChatGPT developer-mode run, including hidden metadata, external opening, deletion and unsupported-UI behavior. Only then update the production endpoint.
- Establish a dedicated widget origin and declare `_meta.ui.domain` for UI submission. Verify its CSP and host remount behavior. This development card does not assert a hosted widget domain.
- Approve and deploy `public/privacy.html` and `public/terms.html`, confirm the actual operator/contact and hosting-provider data/backups/log policies. These are implementation drafts, not legal approval.
- Provide verified publishing identity, organization/domain permission, current scans, listing logo/screenshots, walkthrough, release notes and five positive/three negative evidence cases. Supply a genuine registered MCP connection mapping if the submission route needs one. Public approval and publication are separate actions.
- Resolve deployment dependency/security-scan findings and capacity settings. Both the original and final lockfiles report the same 26 npm audit advisories (1 low, 6 moderate, 17 high, 2 critical), with direct findings in the existing @vercel/node, Vite and Vitest dependencies. No new advisory was introduced by the two added dependencies, and no broad dependency upgrade is bundled into this prototype. The existing app bundle-size warning also remains.

## Official sources checked

[Portable package and marketplace format](https://developers.openai.com/plugins/build/plugins), [MCP Apps UI](https://developers.openai.com/plugins/build/chatgpt-ui), [private tool result metadata](https://developers.openai.com/plugins/reference), [authentication recommendations](https://developers.openai.com/plugins/build/auth), [tool annotations and data boundaries](https://developers.openai.com/plugins/plugin-guidelines), [submission requirements](https://developers.openai.com/plugins/deploy/submission). Sources checked September 30, 2026. Eligibility remains a review question; the package makes no claim of directory acceptance.
