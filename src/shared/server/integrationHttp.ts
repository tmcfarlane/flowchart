import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleMcp } from './http.js'
import { handleOpenAIAuthStart, handleOpenAIAuthCallback, handleOpenAIAuthSession, handleOpenAIAuthSignout, type OpenAIAuthContext } from './openaiAuthHttp.js'

/** An untrusted routing selector, never proof of identity or configuration. */
export const OPENAI_AUTH_ROUTE_QUERY = '__flowchart_openai_auth'
export type OpenAIAuthAction = 'start' | 'callback' | 'session' | 'signout'
export interface IntegrationRequest extends IncomingMessage { query?: Record<string, string | string[] | undefined> }
export type IntegrationHandler = (req: IntegrationRequest, res: ServerResponse) => Promise<void>
const handlers = { start: handleOpenAIAuthStart, callback: handleOpenAIAuthCallback, session: handleOpenAIAuthSession, signout: handleOpenAIAuthSignout }
function actionForRequest(req: IntegrationRequest): OpenAIAuthAction | null {
  const url = new URL(req.url ?? '/', 'http://routing.invalid')
  const raw = url.searchParams.getAll(OPENAI_AUTH_ROUTE_QUERY)
  const parsed = req.query?.[OPENAI_AUTH_ROUTE_QUERY]
  if (raw.length > 1 || (parsed !== undefined && typeof parsed !== 'string')) throw new Error('Invalid routing selector')
  if (parsed !== undefined && raw.length && parsed !== raw[0]) throw new Error('Conflicting routing selector')
  const selected = parsed ?? raw[0]
  if (selected === undefined) return null
  if (!['start', 'callback', 'session', 'signout'].includes(selected)) throw new Error('Unknown routing selector')
  return selected as OpenAIAuthAction
}
function callbackRequest(req: IntegrationRequest): IntegrationRequest {
  const url = new URL(req.url ?? '/', 'http://routing.invalid')
  // Vercel can expose rewrite query parameters in req.query, req.url, or both.
  // Keep all duplicate OAuth values; the auth handler consumes then rejects them.
  for (const key of ['state', 'code', 'error']) {
    const parsed = req.query?.[key]
    if (parsed === undefined) continue
    const values = typeof parsed === 'string' ? [parsed] : parsed
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) throw new Error('Invalid callback query')
    const raw = url.searchParams.getAll(key)
    if (raw.length === values.length && raw.every((value, index) => value === values[index])) continue
    for (const value of values) url.searchParams.append(key, value)
  }
  const routed = Object.create(req) as IntegrationRequest
  routed.url = `/api/auth/openai/callback${url.search}`
  return routed
}
function invalidRoute(res: ServerResponse) {
  res.statusCode = 400
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.end(JSON.stringify({ error: 'This integration route is unavailable.', code: 'invalid_integration_route' }))
}

/** Share the existing Vercel function without widening any auth handler policy. */
export function createIntegrationHandler(overrides: { authContext?: OpenAIAuthContext; mcpHandler?: IntegrationHandler } = {}): IntegrationHandler {
  const mcp = overrides.mcpHandler ?? handleMcp
  return async (req, res) => {
    let action: OpenAIAuthAction | null
    let routed = req
    try {
      action = actionForRequest(req)
      if (action === 'callback') routed = callbackRequest(req)
    } catch { invalidRoute(res); return }
    if (!action) { await mcp(req, res); return }
    // Dispatch before MCP's permissive CORS, JSON-RPC processing or storage.
    await handlers[action](routed, res, overrides.authContext)
  }
}
export const handleIntegration = createIntegrationHandler()
