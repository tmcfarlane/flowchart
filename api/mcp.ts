// Remote MCP server (Streamable HTTP, stateless): https://flowchart.zeroclickdev.ai/api/mcp
// Tools: create_flowchart, get_flowchart, list_node_types, search_azure_icons,
// search_icons, list_diagram_templates, get_diagram_template, audit_diagram.
// See docs/mcp.md. Imports use explicit .js extensions: Vercel runs these files as native ESM.

import { handleMcp } from '../src/shared/server/http.js'

export default handleMcp
