// Remote MCP server (Streamable HTTP, stateless): https://flowchart.zeroclickdev.ai/api/mcp
// Tools: create_flowchart, get_flowchart, list_node_types, search_azure_icons,
// search_icons, list_diagram_templates, get_diagram_template, audit_diagram.
// See docs/mcp.md. Imports use explicit .js extensions: Vercel runs these files as native ESM.

// Exact website-auth rewrites share this function to stay within the hosting
// function limit. Ordinary requests still use the unchanged MCP handler.
import { handleIntegration } from '../src/shared/server/integrationHttp.js'

export default handleIntegration
