// POST /api/flows: create a shared flowchart. Returns { id, version, url, editUrl, editToken, chart }.
// See docs/mcp.md. Imports use explicit .js extensions: Vercel runs these files as native ESM.

import { handleFlowsCollection } from '../../src/shared/server/http.js'

export default handleFlowsCollection
