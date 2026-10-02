// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import mcpEntry from '../../../api/mcp'
import { createIntegrationHandler, handleIntegration, OPENAI_AUTH_ROUTE_QUERY, type IntegrationRequest, type IntegrationHandler } from '../../shared/server/integrationHttp'
import { createOpenAIAuthContext, OPENAI_AUTH_TRANSACTION_COOKIE, OPENAI_AUTH_SESSION_COOKIE, OPENAI_AUTH_CSRF_HEADER } from '../../shared/server/openaiAuthHttp'
import { MemoryOpenAIAuthStore } from '../../shared/server/openaiAuthStore'
import { OPENAI_AUTH_ISSUER, OPENAI_AUTH_DISCOVERY_URL } from '../../shared/server/openaiAuthConfig'
import { API_ROUTE_MODULES, matchApiRoute } from '../../shared/server/nodeAdapter'

const ORIGIN = 'https://routing.example'
const ENV = { PUBLIC_BASE_URL: ORIGIN, OPENAI_SIGN_IN_ENABLED: 'true', OPENAI_SIGN_IN_CLIENT_ID: 'oaiapp_routing_fixture', OPENAI_SIGN_IN_REDIRECT_URI: `${ORIGIN}/api/auth/openai/callback`, OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: 'none' }
let privateKey: CryptoKey
let publicJwk: Record<string, unknown>
beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  privateKey = pair.privateKey
  publicJwk = { ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'routing-fixture' }
})
function response() {
  const headers = new Map<string, unknown>()
  const res = { statusCode: 200, setHeader: (name: string, value: unknown) => headers.set(name.toLowerCase(), value), getHeader: (name: string) => headers.get(name.toLowerCase()), end: vi.fn() }
  return { res: res as unknown as ServerResponse, headers, json: () => JSON.parse(String(res.end.mock.calls[0]?.[0] ?? '{}')) }
}
function request(url: string, query?: IntegrationRequest['query'], method = 'GET', headers: Record<string, string> = {}): IntegrationRequest {
  return { url, query, method, headers, socket: { remoteAddress: '127.0.0.1' } } as IntegrationRequest
}
async function call(handler: IntegrationHandler, req: IntegrationRequest) {
  const result = response()
  await handler(req, result.res)
  return result
}
function cookie(result: ReturnType<typeof response>, name: string) {
  return (result.headers.get('set-cookie') as string[] | undefined)?.find((value) => value.startsWith(`${name}=`))?.split(';')[0]
}
async function fixture() {
  let nonce = ''
  let challenge = ''
  const code = 'fixture/code+with=encoding'
  const tokenRequests: RequestInit[] = []
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === OPENAI_AUTH_DISCOVERY_URL) return Response.json({ issuer: OPENAI_AUTH_ISSUER, authorization_endpoint: `${OPENAI_AUTH_ISSUER}/api/accounts/authorize`, token_endpoint: `${OPENAI_AUTH_ISSUER}/api/accounts/oauth/token`, jwks_uri: `${OPENAI_AUTH_ISSUER}/.well-known/jwks.json` })
    if (url === `${OPENAI_AUTH_ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [publicJwk] })
    if (url === `${OPENAI_AUTH_ISSUER}/api/accounts/oauth/token`) {
      tokenRequests.push(init ?? {})
      const body = new URLSearchParams(init?.body as URLSearchParams)
      expect(body.get('code')).toBe(code)
      expect(body.get('redirect_uri')).toBe(ENV.OPENAI_SIGN_IN_REDIRECT_URI)
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(challenge)
      return Response.json({ id_token: await new SignJWT({ nonce, name: 'Routing Fixture' }).setIssuer(OPENAI_AUTH_ISSUER).setAudience(ENV.OPENAI_SIGN_IN_CLIENT_ID).setSubject('routing-fixture-subject').setIssuedAt().setExpirationTime('5m').setProtectedHeader({ alg: 'RS256', kid: 'routing-fixture' }).sign(privateKey) })
    }
    throw new Error('Unrecognized injected upstream')
  }) as unknown as typeof fetch
  const auth = createOpenAIAuthContext(ENV, { store: new MemoryOpenAIAuthStore(), fetcher })
  const mcp = vi.fn(async (_req: IntegrationRequest, res: ServerResponse) => { res.statusCode = 209; res.end('MCP delegate') })
  const handler = createIntegrationHandler({ authContext: auth, mcpHandler: mcp })
  async function start() {
    const result = await call(handler, request(`/api/mcp?${OPENAI_AUTH_ROUTE_QUERY}=start`, { [OPENAI_AUTH_ROUTE_QUERY]: 'start' }))
    expect(result.res.statusCode).toBe(302)
    const url = new URL(String(result.headers.get('location')))
    nonce = url.searchParams.get('nonce')!
    challenge = url.searchParams.get('code_challenge')!
    return { result, state: url.searchParams.get('state')!, cookie: cookie(result, OPENAI_AUTH_TRANSACTION_COOKIE)! }
  }
  return { handler, mcp, fetcher, tokenRequests, start, code }
}

describe('Shared MCP and website-auth routing', () => {
  it('exports the integration handler from the existing MCP function', () => {
    expect(mcpEntry).toBe(handleIntegration)
  })
  it('keeps exactly twelve API functions and four exact public rewrites', async () => {
    async function files(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true })
      const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`]))
      return nested.flat()
    }
    expect((await files('api')).filter((name) => name.endsWith('.ts'))).toHaveLength(12)
    const config = JSON.parse(await readFile('vercel.json', 'utf8'))
    const auth = config.rewrites.filter((rule: { source: string }) => rule.source.startsWith('/api/auth/'))
    expect(auth).toEqual(['start', 'callback', 'session', 'signout'].map((action) => ({ source: `/api/auth/openai/${action}`, destination: `/api/mcp?${OPENAI_AUTH_ROUTE_QUERY}=${action}` })))
    for (const action of ['start', 'callback', 'session', 'signout']) {
      const route = matchApiRoute(`/api/auth/openai/${action}`)!
      expect(route.params).toEqual({ [OPENAI_AUTH_ROUTE_QUERY]: action })
      expect(API_ROUTE_MODULES[route.name]).toBe('/api/mcp.ts')
    }
  })
  it.each(['GET', 'POST', 'OPTIONS', 'DELETE'])('passes marker-absent %s requests untouched to MCP, with no auth provider or store work', async (method) => {
    const f = await fixture()
    const req = request('/api/mcp?state=irrelevant', { state: 'irrelevant' }, method)
    const original = { url: req.url, query: req.query, headers: req.headers }
    const result = await call(f.handler, req)
    expect(result.res.statusCode).toBe(209)
    expect(f.mcp).toHaveBeenCalledTimes(1)
    expect(f.mcp).toHaveBeenCalledWith(req, result.res)
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(req).toMatchObject(original)
  })
  it.each([
    [`/api/mcp?${OPENAI_AUTH_ROUTE_QUERY}=unknown`, undefined],
    [`/api/mcp?${OPENAI_AUTH_ROUTE_QUERY}=`, undefined],
    ['/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: ['session'] }],
    ['/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: ['session', 'start'] }],
    [`/api/mcp?${OPENAI_AUTH_ROUTE_QUERY}=session&${OPENAI_AUTH_ROUTE_QUERY}=session`, { [OPENAI_AUTH_ROUTE_QUERY]: 'session' }],
    [`/api/mcp?${OPENAI_AUTH_ROUTE_QUERY}=session`, { [OPENAI_AUTH_ROUTE_QUERY]: 'start' }],
  ])('rejects malformed selectors before auth or permissive MCP CORS: %s', async (url, query) => {
    const f = await fixture()
    const result = await call(f.handler, request(url, query))
    expect(result.res.statusCode).toBe(400)
    expect(result.json().code).toBe('invalid_integration_route')
    expect(result.headers.get('cache-control')).toContain('no-store')
    expect(result.headers.get('referrer-policy')).toBe('no-referrer')
    expect(result.headers.has('access-control-allow-origin')).toBe(false)
    expect(result.headers.has('set-cookie')).toBe(false)
    expect(f.mcp).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it.each(['url', 'query', 'both'])('preserves callback state/code with rewritten Vercel %s query shape and creates the actual signed session', async (shape) => {
    const f = await fixture()
    const tx = await f.start()
    const params = new URLSearchParams({ [OPENAI_AUTH_ROUTE_QUERY]: 'callback' })
    if (shape !== 'query') { params.set('state', tx.state); params.set('code', f.code) }
    const query = shape === 'url' ? undefined : { [OPENAI_AUTH_ROUTE_QUERY]: 'callback', state: tx.state, code: f.code }
    const req = request(`/api/mcp?${params}`, query, 'GET', { cookie: tx.cookie, origin: OPENAI_AUTH_ISSUER, 'sec-fetch-site': 'cross-site' })
    const originalUrl = req.url
    const result = await call(f.handler, req)
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=success')
    expect(req.url).toBe(originalUrl)
    expect(f.tokenRequests).toHaveLength(1)
    expect(f.mcp).not.toHaveBeenCalled()
    const sessionCookie = cookie(result, OPENAI_AUTH_SESSION_COOKIE)!
    const session = await call(f.handler, request('/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: 'session' }, 'GET', { cookie: sessionCookie }))
    expect(session.json()).toMatchObject({ authenticated: true, user: { name: 'Routing Fixture', email: null }, planUsageAvailable: false })
    const signout = await call(f.handler, request('/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: 'signout' }, 'POST', { cookie: sessionCookie, origin: ORIGIN, [OPENAI_AUTH_CSRF_HEADER]: session.json().csrfToken }))
    expect(signout.json()).toEqual({ signedOut: true })
    expect((await call(f.handler, request('/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: 'session' }, 'GET', { cookie: sessionCookie }))).json().authenticated).toBe(false)
  })
  it.each(['state', 'code'])('retains duplicated query-only callback %s and rejects before token exchange', async (field) => {
    const f = await fixture()
    const tx = await f.start()
    const query = { [OPENAI_AUTH_ROUTE_QUERY]: 'callback', state: tx.state, code: f.code, [field]: [field === 'state' ? tx.state : f.code, 'duplicate'] }
    const result = await call(f.handler, request('/api/mcp', query, 'GET', { cookie: tx.cookie }))
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(f.tokenRequests).toHaveLength(0)
    expect(f.mcp).not.toHaveBeenCalled()
  })
  it('conflicting parsed/raw OAuth state cannot collapse to a valid first value', async () => {
    const f = await fixture()
    const tx = await f.start()
    const params = new URLSearchParams({ [OPENAI_AUTH_ROUTE_QUERY]: 'callback', state: tx.state, code: f.code })
    const result = await call(f.handler, request(`/api/mcp?${params}`, { [OPENAI_AUTH_ROUTE_QUERY]: 'callback', state: 'different-state', code: f.code }, 'GET', { cookie: tx.cookie }))
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(f.tokenRequests).toHaveLength(0)
  })
  it('preserves query-only authorization cancellation and fixed redirect', async () => {
    const f = await fixture()
    const tx = await f.start()
    const result = await call(f.handler, request('/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: 'callback', state: tx.state, error: 'access_denied' }, 'GET', { cookie: tx.cookie }))
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=cancelled')
    expect(f.tokenRequests).toHaveLength(0)
  })
  it('auth OPTIONS never inherits wildcard MCP CORS, and signout keeps strict origin/CSRF', async () => {
    const f = await fixture()
    const options = await call(f.handler, request('/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: 'session' }, 'OPTIONS', { origin: 'https://evil.example' }))
    expect(options.res.statusCode).toBe(405)
    expect(options.headers.has('access-control-allow-origin')).toBe(false)
    const signout = await call(f.handler, request('/api/mcp', { [OPENAI_AUTH_ROUTE_QUERY]: 'signout' }, 'POST', { origin: 'https://evil.example' }))
    expect(signout.res.statusCode).toBe(403)
    expect(f.mcp).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('the public callback dev route supplies only the routing selector while preserving ordinary OAuth URL', async () => {
    const f = await fixture()
    const tx = await f.start()
    const route = matchApiRoute('/api/auth/openai/callback')!
    const params = new URLSearchParams({ state: tx.state, code: f.code })
    const result = await call(f.handler, request(`/api/auth/openai/callback?${params}`, route.params, 'GET', { cookie: tx.cookie }))
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=success')
    expect(f.tokenRequests).toHaveLength(1)
  })
})
