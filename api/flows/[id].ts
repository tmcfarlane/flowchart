// GET /api/flows/:id[?since=<version>]  read a chart (cheap "changed?" check with since)
// PUT /api/flows/:id                    replace it   (Authorization: Bearer <editToken>, optional baseVersion)
// PATCH /api/flows/:id                  apply operations (same auth)
// See docs/mcp.md. Imports use explicit .js extensions: Vercel runs these files as native ESM.

import { handleFlowItem } from '../../src/shared/server/http.js'

export default handleFlowItem
