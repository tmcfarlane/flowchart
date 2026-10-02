// Runs the Vercel function handlers on a plain Node HTTP server: used by the
// Vite dev middleware (vite.config.ts) and the HTTP-level tests. Emulates the
// two things Vercel adds to requests: `req.query` and a parsed `req.body`.

import type { IncomingMessage } from 'node:http'
import { BODY_TOO_LARGE_FLAG, MCP_MAX_BODY_BYTES } from './http.js'

export type ApiRouteName = 'mcp' | 'flows' | 'flow' | 'chat' | 'billingSession' | 'billingCheckout' | 'billingPortal' | 'billingWebhook' | 'billingRecovery' | 'billingRestore' | 'images' | 'imageAsset'

/** Map a path to the api/ function Vercel would run for it. */
export function matchApiRoute(pathname: string): { name: ApiRouteName; params: Record<string, string> } | null {
  const asset = pathname.match(/^\/api\/images\/([^/]+)\/?$/)
  if (asset) return { name: 'imageAsset', params: { id: asset[1] } }
  const extra: Record<string, ApiRouteName> = { '/api/chat': 'chat', '/api/billing/session': 'billingSession', '/api/billing/checkout': 'billingCheckout', '/api/billing/portal': 'billingPortal', '/api/billing/webhook': 'billingWebhook', '/api/billing/recovery': 'billingRecovery', '/api/billing/restore': 'billingRestore', '/api/images': 'images' }
  if (extra[pathname.replace(/\/$/, '')]) return { name: extra[pathname.replace(/\/$/, '')], params: {} }
  if (pathname === '/api/mcp' || pathname === '/api/mcp/') return { name: 'mcp', params: {} }
  if (pathname === '/api/flows' || pathname === '/api/flows/') return { name: 'flows', params: {} }
  const match = pathname.match(/^\/api\/flows\/([^/]+)\/?$/)
  if (match) {
    let id = match[1]
    try {
      id = decodeURIComponent(id)
    } catch {
      // keep the raw segment; the handler answers 404 for malformed ids
    }
    return { name: 'flow', params: { id } }
  }
  return null
}

/** Module that implements each route (relative to the project root). */
export const API_ROUTE_MODULES: Record<ApiRouteName, string> = {
  chat: '/api/chat.ts',
  billingSession: '/api/billing/session.ts', billingCheckout: '/api/billing/checkout.ts',
  billingPortal: '/api/billing/portal.ts', billingWebhook: '/api/billing/webhook.ts',
  billingRecovery: '/api/billing/recovery.ts', billingRestore: '/api/billing/restore.ts',
  images: '/api/images.ts', imageAsset: '/api/images/[id].ts',
  mcp: '/api/mcp.ts',
  flows: '/api/flows/index.ts',
  flow: '/api/flows/[id].ts',
}

type MutableRequest = IncomingMessage & {
  body?: unknown
  rawBody?: Buffer
  query?: Record<string, string | string[] | undefined>
}

export async function prepareVercelStyleRequest(
  req: IncomingMessage,
  params: Record<string, string> = {},
  maxBytes: number = MCP_MAX_BODY_BYTES,
): Promise<void> {
  const request = req as MutableRequest
  const url = new URL(req.url ?? '/', 'http://localhost')
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of url.searchParams) {
    const existing = query[key]
    query[key] = existing === undefined ? value : ([] as string[]).concat(existing, value)
  }
  request.query = { ...query, ...params }

  if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method ?? 'GET')) return

  const chunks: Buffer[] = []
  let size = 0
  let tooLarge = false
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buf.length
    if (size > maxBytes) tooLarge = true
    else chunks.push(buf)
  }
  if (tooLarge) {
    ;(request as unknown as Record<string, unknown>)[BODY_TOO_LARGE_FLAG] = true
    request.body = undefined
    return
  }

  request.rawBody = Buffer.concat(chunks)
  const raw = request.rawBody.toString('utf8')
  if (!raw) {
    request.body = undefined
    return
  }
  const contentType = String(req.headers['content-type'] ?? '')
  if (!contentType.includes('json')) {
    request.body = raw
    return
  }
  try {
    request.body = JSON.parse(raw)
  } catch {
    // Like Vercel: reading req.body throws when the JSON is invalid.
    Object.defineProperty(request, 'body', {
      configurable: true,
      get() {
        throw new Error('Invalid JSON')
      },
    })
  }
}
