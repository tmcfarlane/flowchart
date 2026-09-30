// HTTP handlers behind the Vercel functions api/flows/index.ts, api/flows/[id].ts
// and api/mcp.ts. The Vite dev server mounts the same handlers (vite.config.ts),
// so local development runs exactly this code.
//
// Handlers only rely on Node's IncomingMessage/ServerResponse plus `req.body`
// and `req.query`, which Vercel provides and nodeAdapter.ts emulates.

import type { IncomingMessage, ServerResponse } from 'node:http'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { LIMITS, type Chart } from '../flowTypes.js'
import {
  CreateFlowBodySchema,
  PatchFlowBodySchema,
  ReplaceFlowBodySchema,
  issuesFromZod,
} from '../flowSchema.js'
import { FlowService, type ServiceError } from './flowService.js'
import { chartLinks, createFlowchartMcpServer } from './mcpServer.js'
import {
  createRateLimiterFromEnv,
  rateLimitMessage,
  writeQuota,
  type RateBucket,
  type RateLimiter,
  type WriteQuota,
} from './rateLimit.js'
import {
  StorageNotConfiguredError,
  StorageUnavailableError,
  createStoreFromEnv,
  redisClient,
  resolveRedisConfig,
  type FlowStore,
} from './store.js'
import { isValidChartId } from './tokens.js'

export interface ApiRequest extends IncomingMessage {
  body?: unknown
  query?: Record<string, string | string[] | undefined>
}

type Env = Record<string, string | undefined>

export interface ApiContext {
  env: Env
  limiter: RateLimiter
  /** Throws StorageNotConfiguredError when storage is missing in production. */
  getService(): FlowService
}

export function createApiContext(env: Env = process.env, overrides: { store?: FlowStore; limiter?: RateLimiter } = {}): ApiContext {
  let service: FlowService | undefined
  let failure: StorageNotConfiguredError | undefined
  const redis = resolveRedisConfig(env)
  return {
    env,
    limiter: overrides.limiter ?? createRateLimiterFromEnv(env, redis ? redisClient(redis) : null),
    getService() {
      if (service) return service
      if (failure) throw failure
      try {
        service = new FlowService({ store: overrides.store ?? createStoreFromEnv(env) })
        return service
      } catch (err) {
        if (err instanceof StorageNotConfiguredError) failure = err
        throw err
      }
    },
  }
}

let defaultContext: ApiContext | undefined
function getDefaultContext(): ApiContext {
  return (defaultContext ??= createApiContext(process.env))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set by nodeAdapter.ts when a streamed body exceeded its size cap. */
export const BODY_TOO_LARGE_FLAG = '__flowchartBodyTooLarge'

const DEFAULT_ALLOWED_HEADERS =
  'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID'

/** CORS for browser-based clients. No cookies are involved (auth is a bearer edit token), so any origin is fine. */
export function applyCors(req: IncomingMessage, res: ServerResponse, methods: string): void {
  const requested = req.headers['access-control-request-headers']
  const allowHeaders =
    typeof requested === 'string' && /^[\w\s,-]{1,500}$/.test(requested) ? requested : DEFAULT_ALLOWED_HEADERS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', allowHeaders)
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Mcp-Session-Id, Mcp-Protocol-Version, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, Location',
  )
  res.setHeader('Access-Control-Max-Age', '86400')
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end()
    return
  }
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  res.end(JSON.stringify(body))
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * The client's IP address, for rate limits. Forwarding headers are trusted only
 * on Vercel, whose edge overwrites them (clients can't spoof them there), or
 * when FLOW_TRUST_PROXY=1 says a proxy you run sets them. Otherwise anyone
 * could send a fresh X-Forwarded-For per request and dodge the limits.
 */
export function clientIp(req: IncomingMessage, env: Env = {}): string {
  const trusted = env.VERCEL === '1' || env.FLOW_TRUST_PROXY === '1' || env.FLOW_TRUST_PROXY === 'true'
  if (trusted) {
    const forwarded =
      header(req, 'x-vercel-forwarded-for')?.split(',')[0]?.trim() ||
      header(req, 'x-real-ip')?.trim() ||
      header(req, 'x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return req.socket?.remoteAddress || 'unknown'
}

const DEFAULT_PUBLIC_URL = 'https://flowchart.zeroclickdev.ai'

/** PUBLIC_BASE_URL, else the (forwarded) host of the request, else the production domain. */
export function publicBaseUrl(req: IncomingMessage, env: Env): string {
  const configured = env.PUBLIC_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const host = (header(req, 'x-forwarded-host') ?? header(req, 'host'))?.split(',')[0]?.trim()
  if (host && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)) {
    const forwardedProto = header(req, 'x-forwarded-proto')?.split(',')[0]?.trim()
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(host)
    const proto = forwardedProto === 'http' || forwardedProto === 'https' ? forwardedProto : local ? 'http' : 'https'
    return `${proto}://${host}`
  }
  return DEFAULT_PUBLIC_URL
}

function queryParam(req: ApiRequest, name: string): string | undefined {
  const fromQuery = req.query?.[name]
  if (typeof fromQuery === 'string') return fromQuery
  if (Array.isArray(fromQuery)) return fromQuery[0]
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams.get(name) ?? undefined
  } catch {
    return undefined
  }
}

function routeId(req: ApiRequest): string {
  const fromQuery = queryParam(req, 'id')
  if (fromQuery) return fromQuery
  const match = (req.url ?? '').match(/\/api\/flows\/([^/?#]+)/)
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function bearerToken(req: IncomingMessage): string | undefined {
  const match = header(req, 'authorization')?.match(/^Bearer\s+(\S+)\s*$/i)
  return match ? match[1] : undefined
}

type BodyResult = { ok: true; body: unknown } | { ok: false; status: number; error: string }

/** Read the JSON body (Vercel parses lazily and throws on invalid JSON) and enforce the size limit. */
export function readJsonBody(req: ApiRequest, maxBytes: number = LIMITS.maxBodyBytes): BodyResult {
  const tooLarge: BodyResult = {
    ok: false,
    status: 413,
    error: `Request body is too large; the limit is ${Math.round(maxBytes / 1024)} KB.`,
  }
  const declared = Number(header(req, 'content-length'))
  if ((Number.isFinite(declared) && declared > maxBytes) || (req as unknown as Record<string, unknown>)[BODY_TOO_LARGE_FLAG]) {
    return tooLarge
  }
  let body: unknown
  try {
    body = req.body
  } catch {
    return { ok: false, status: 400, error: 'Request body is not valid JSON.' }
  }
  if (Buffer.isBuffer(body)) body = body.toString('utf8')
  if (typeof body === 'string') {
    if (!body.trim()) return { ok: true, body: undefined }
    if (Buffer.byteLength(body, 'utf8') > maxBytes) return tooLarge
    try {
      body = JSON.parse(body)
    } catch {
      return { ok: false, status: 400, error: 'Request body is not valid JSON.' }
    }
  } else if (body !== undefined && Buffer.byteLength(JSON.stringify(body), 'utf8') > maxBytes) {
    return tooLarge
  }
  return { ok: true, body }
}

async function enforceRateLimit(
  ctx: ApiContext,
  bucket: RateBucket,
  req: IncomingMessage,
  res: ServerResponse,
  { jsonRpc = false, cost = 1 }: { jsonRpc?: boolean; cost?: number } = {},
): Promise<boolean> {
  const result = await ctx.limiter.check(bucket, clientIp(req, ctx.env), cost)
  if (Number.isFinite(result.limit) && result.scope === 'ip') {
    res.setHeader('X-RateLimit-Limit', String(result.limit))
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, result.remaining)))
  }
  if (result.allowed) return false
  sendRateLimited(res, rateLimitMessage(bucket, result), result.retryAfterSeconds, jsonRpc, result.scope)
  return true
}

function sendRateLimited(
  res: ServerResponse,
  message: string,
  retryAfterSeconds: number,
  jsonRpc = false,
  scope?: 'ip' | 'global',
): void {
  sendJson(
    res,
    429,
    jsonRpc
      ? { jsonrpc: '2.0', error: { code: -32000, message }, id: null }
      : { error: message, code: 'rate_limited', retryAfterSeconds, ...(scope ? { scope } : {}) },
    { 'Retry-After': String(retryAfterSeconds) },
  )
}

/** Quota for the rest of a create or update (large layouts, storage growth). */
function requestQuota(ctx: ApiContext, bucket: RateBucket, req: IncomingMessage): WriteQuota {
  const ip = clientIp(req, ctx.env)
  return writeQuota((b, cost) => ctx.limiter.check(b, ip, cost), bucket)
}

const SERVICE_STATUS: Record<ServiceError['code'], number> = {
  validation: 400,
  not_found: 404,
  unauthorized: 403,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
}

function sendServiceError(res: ServerResponse, error: ServiceError): void {
  if (error.code === 'rate_limited') return sendRateLimited(res, error.message, error.retryAfterSeconds)
  sendJson(res, SERVICE_STATUS[error.code], {
    error: error.message,
    code: error.code,
    ...(error.code === 'validation' ? { issues: error.issues } : {}),
    ...(error.code === 'conflict' ? { currentVersion: error.currentVersion } : {}),
  })
}

function handleUnexpected(res: ServerResponse, err: unknown, jsonRpc = false): void {
  if (err instanceof StorageNotConfiguredError || err instanceof StorageUnavailableError) {
    const code = err instanceof StorageNotConfiguredError ? 'storage_not_configured' : 'storage_unavailable'
    const headers: Record<string, string> = err instanceof StorageUnavailableError ? { 'Retry-After': '30' } : {}
    sendJson(
      res,
      503,
      jsonRpc ? { jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: null } : { error: err.message, code },
      headers,
    )
    return
  }
  console.error('[flowchart] Unexpected API error', err)
  sendJson(
    res,
    500,
    jsonRpc
      ? { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }
      : { error: 'Internal server error', code: 'internal' },
  )
}

function chartResponse(chart: Chart, baseUrl: string) {
  return { ...chart, url: chartLinks(baseUrl, chart.id).url }
}

function methodNotAllowed(res: ServerResponse, allow: string): void {
  sendJson(res, 405, { error: `Method not allowed. Use ${allow}.`, code: 'method_not_allowed' }, { Allow: allow })
}

// ---------------------------------------------------------------------------
// /api/flows
// ---------------------------------------------------------------------------

export async function handleFlowsCollection(req: ApiRequest, res: ServerResponse, ctx?: ApiContext): Promise<void> {
  applyCors(req, res, 'POST, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST, OPTIONS')
  const context = ctx ?? getDefaultContext()
  try {
    if (await enforceRateLimit(context, 'create', req, res)) return
    const body = readJsonBody(req)
    if (!body.ok) return sendJson(res, body.status, { error: body.error, code: body.status === 413 ? 'too_large' : 'invalid_json' })
    const parsed = CreateFlowBodySchema.safeParse(body.body ?? {})
    if (!parsed.success) {
      return sendJson(res, 400, { error: 'Invalid request body.', code: 'validation', issues: issuesFromZod(parsed.error) })
    }
    const result = await context.getService().create({
      title: parsed.data.title ?? 'Untitled flowchart',
      nodes: parsed.data.nodes,
      edges: parsed.data.edges ?? [],
      direction: parsed.data.direction,
      source: 'api',
      quota: requestQuota(context, 'create', req),
    })
    if (!result.ok) return sendServiceError(res, result)
    const baseUrl = publicBaseUrl(req, context.env)
    const links = chartLinks(baseUrl, result.chart.id, result.editToken)
    sendJson(
      res,
      201,
      {
        id: result.chart.id,
        version: result.chart.version,
        url: links.url,
        editUrl: links.editUrl,
        editToken: result.editToken,
        chart: chartResponse(result.chart, baseUrl),
      },
      { Location: `/api/flows/${result.chart.id}` },
    )
  } catch (err) {
    handleUnexpected(res, err)
  }
}

// ---------------------------------------------------------------------------
// /api/flows/:id
// ---------------------------------------------------------------------------

export async function handleFlowItem(req: ApiRequest, res: ServerResponse, ctx?: ApiContext): Promise<void> {
  const allow = 'GET, HEAD, PUT, PATCH, OPTIONS'
  applyCors(req, res, allow)
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (!['GET', 'HEAD', 'PUT', 'PATCH'].includes(req.method ?? '')) return methodNotAllowed(res, allow)

  const context = ctx ?? getDefaultContext()
  const id = routeId(req)
  const notFound = () =>
    sendJson(res, 404, { error: `No flowchart with id ${JSON.stringify(id)}.`, code: 'not_found' })

  try {
    if (req.method === 'GET' || req.method === 'HEAD') {
      const sinceRaw = queryParam(req, 'since')
      const polling = sinceRaw !== undefined && /^\d{1,15}$/.test(sinceRaw)
      // Polls and reads are counted in memory per instance: a Redis-backed check
      // would cost more Redis commands than the read it protects.
      if (await enforceRateLimit(context, polling ? 'poll' : 'read', req, res)) return
      if (!isValidChartId(id)) return notFound()
      const service = context.getService()
      if (polling) {
        // Cheap polling check: one HGET for the version, the chart only if it changed.
        const version = await service.getVersion(id)
        if (version === null) return notFound()
        if (version <= Number(sinceRaw)) return sendJson(res, 200, { id, version, changed: false })
      }
      const chart = await service.get(id)
      if (!chart) return notFound()
      const payload = chartResponse(chart, publicBaseUrl(req, context.env))
      return sendJson(res, 200, sinceRaw !== undefined ? { ...payload, changed: true } : payload)
    }

    // PUT (replace) and PATCH (operations) need the chart's edit token.
    if (await enforceRateLimit(context, 'write', req, res)) return
    if (!isValidChartId(id)) return notFound()
    const token = bearerToken(req)
    if (!token) {
      return sendJson(
        res,
        401,
        { error: 'Missing edit token. Send "Authorization: Bearer <editToken>".', code: 'unauthorized' },
        { 'WWW-Authenticate': 'Bearer' },
      )
    }
    const body = readJsonBody(req)
    if (!body.ok) return sendJson(res, body.status, { error: body.error, code: body.status === 413 ? 'too_large' : 'invalid_json' })
    const service = context.getService()
    const baseUrl = publicBaseUrl(req, context.env)
    const quota = requestQuota(context, 'write', req)

    if (req.method === 'PUT') {
      const parsed = ReplaceFlowBodySchema.safeParse(body.body ?? {})
      if (!parsed.success) {
        return sendJson(res, 400, { error: 'Invalid request body.', code: 'validation', issues: issuesFromZod(parsed.error) })
      }
      const result = await service.replace(id, token, {
        title: parsed.data.title,
        nodes: parsed.data.nodes,
        edges: parsed.data.edges ?? [],
        expectedVersion: parsed.data.baseVersion,
        direction: parsed.data.direction,
        relayout: parsed.data.relayout,
        source: 'api',
        quota,
      })
      if (!result.ok) return sendServiceError(res, result)
      return sendJson(res, 200, chartResponse(result.chart, baseUrl))
    }

    const parsed = PatchFlowBodySchema.safeParse(body.body ?? {})
    if (!parsed.success) {
      return sendJson(res, 400, { error: 'Invalid request body.', code: 'validation', issues: issuesFromZod(parsed.error) })
    }
    const result = await service.applyOperations(id, token, {
      operations: parsed.data.operations,
      title: parsed.data.title,
      expectedVersion: parsed.data.baseVersion,
      direction: parsed.data.direction,
      relayout: parsed.data.relayout,
      source: 'api',
      quota,
    })
    if (!result.ok) return sendServiceError(res, result)
    return sendJson(res, 200, { ...chartResponse(result.chart, baseUrl), changes: result.summary })
  } catch (err) {
    handleUnexpected(res, err)
  }
}

// ---------------------------------------------------------------------------
// /api/mcp (Streamable HTTP, stateless)
// ---------------------------------------------------------------------------

/** Room for the JSON-RPC envelope around a maximum-size chart. */
export const MCP_MAX_BODY_BYTES = LIMITS.maxBodyBytes + 64 * 1024

export async function handleMcp(req: ApiRequest, res: ServerResponse, ctx?: ApiContext): Promise<void> {
  applyCors(req, res, 'GET, POST, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') {
    // Stateless server: there is no standalone SSE stream (GET) and no session to end (DELETE).
    return sendJson(
      res,
      405,
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed. This MCP server is stateless: send JSON-RPC messages with POST.' },
        id: null,
      },
      { Allow: 'POST, OPTIONS' },
    )
  }

  const context = ctx ?? getDefaultContext()
  try {
    if (await enforceRateLimit(context, 'mcp', req, res, { jsonRpc: true })) return
    const body = readJsonBody(req, MCP_MAX_BODY_BYTES)
    // A JSON-RPC batch counts once per message (the SDK accepts up to 100).
    if (body.ok && Array.isArray(body.body) && body.body.length > 1) {
      if (await enforceRateLimit(context, 'mcp', req, res, { jsonRpc: true, cost: body.body.length - 1 })) return
    }
    if (!body.ok) {
      return sendJson(res, body.status, {
        jsonrpc: '2.0',
        error: { code: body.status === 413 ? -32600 : -32700, message: body.error },
        id: null,
      })
    }

    const ip = clientIp(req, context.env)
    const server = createFlowchartMcpServer({
      getService: () => context.getService(),
      baseUrl: publicBaseUrl(req, context.env),
      rateLimit: (bucket, cost) => context.limiter.check(bucket, ip, cost),
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body.body)
  } catch (err) {
    handleUnexpected(res, err, true)
  }
}
