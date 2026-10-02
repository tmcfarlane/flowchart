# Flowchart AI development plugin

Portable `plugin.json`, `mcp.json` and `skills/` package for ChatGPT/Codex. This package targets the **MCP v2.1 behavior in this change**. The currently deployed server still needs the reviewed implementation before this package can be used safely. Do not install the production configuration until that server change is deployed.

The authoring skill can browse 20 curated process, business, cloud and creative templates; search Azure icons and 65 original local SVG illustrations; and audit a draft before saving. These helpers are read-only and do not share or store a diagram. Creation still requires deliberate consent to the disclosed link-sharing and retention behavior.

The MCP Apps card previews diagrams using local SVG shapes, connections and escaped text, with zoom controls and a bounded subset for large charts. Image artwork and full editing remain in the browser. Widget-only result metadata supplies the preview and private edit controls; capabilities never enter model-visible results, tool arguments, widget state or logs. The card uses no external images, fonts or scripts. On hosts without UI support, the returned view link remains available.

For local testing, copy this folder to a scratch marketplace and set `mcpServers.flowchart.url` in its `mcp.json` to `http://localhost:3004/api/mcp`. Run `npm install`, `npm run dev` from the repository. The repo marketplace makes this package discoverable; it does not install it or grant write permissions. A remote ChatGPT host needs a reachable HTTPS staging endpoint and developer-mode connection. Its registered technical ID must be supplied by the actual host; none is fabricated here.

Run `npm test -- --run` and `npm run build` before review. See `docs/chatgpt-plugin.md` for behavior, privacy boundaries, test cases, and directory blockers. Public deployment and directory publication require separate review; this is an anonymous development prototype, not a reviewed public listing.
