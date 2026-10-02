// @vitest-environment node
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose'
import startHandler from '../../../api/auth/openai/start'
import callbackHandler from '../../../api/auth/openai/callback'
import sessionHandler from '../../../api/auth/openai/session'
import signoutHandler from '../../../api/auth/openai/signout'
import { OPENAI_AUTH_DISCOVERY_URL, OPENAI_AUTH_ISSUER, openAIAuthConfigFromEnv } from '../../shared/server/openaiAuthConfig'
import { createOpenAIAuthContext, handleOpenAIAuthStart, handleOpenAIAuthCallback, handleOpenAIAuthSession, handleOpenAIAuthSignout, OPENAI_AUTH_TRANSACTION_COOKIE, OPENAI_AUTH_SESSION_COOKIE, OPENAI_AUTH_CSRF_HEADER, type OpenAIAuthContext } from '../../shared/server/openaiAuthHttp'
import { authValuesMatch, openAIAuthStorageKey } from '../../shared/server/openaiAuthService'
import { MemoryOpenAIAuthStore, RedisOpenAIAuthStore, OPENAI_AUTH_PUT_SCRIPT, OPENAI_AUTH_CONSUME_SCRIPT, OPENAI_AUTH_READ_SCRIPT, OPENAI_AUTH_DELETE_SCRIPT, type OpenAIAuthSession, type OpenAIAuthTransaction } from '../../shared/server/openaiAuthStore'

const ENV = { OPENAI_SIGN_IN_ENABLED: 'true', OPENAI_SIGN_IN_CLIENT_ID: 'oaiapp_identity_fixture', OPENAI_SIGN_IN_REDIRECT_URI: 'https://flowchart.example/api/auth/openai/callback', OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: 'none', PUBLIC_BASE_URL: 'https://flowchart.example' }
const DISCOVERY = { issuer: OPENAI_AUTH_ISSUER, authorization_endpoint: `${OPENAI_AUTH_ISSUER}/api/accounts/authorize`, token_endpoint: `${OPENAI_AUTH_ISSUER}/api/accounts/oauth/token`, jwks_uri: `${OPENAI_AUTH_ISSUER}/.well-known/jwks.json` }
type Handler = (req: IncomingMessage, res: ServerResponse, ctx?: OpenAIAuthContext) => Promise<void>
let signingKey: CryptoKey
let wrongSigningKey: CryptoKey
let rotatedSigningKey: CryptoKey
let jwk: Record<string, unknown>
let rotatedJwk: Record<string, unknown>
beforeAll(async () => {
  const [key, wrong, rotated] = await Promise.all([generateKeyPair('RS256'), generateKeyPair('RS256'), generateKeyPair('RS256')])
  signingKey = key.privateKey
  wrongSigningKey = wrong.privateKey
  rotatedSigningKey = rotated.privateKey
  jwk = { ...await exportJWK(key.publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' }
  rotatedJwk = { ...await exportJWK(rotated.publicKey), kid: 'rotated-key', alg: 'RS256', use: 'sig' }
})
afterEach(() => vi.restoreAllMocks())
function response() {
  const values = new Map<string, unknown>()
  const res = { statusCode: 200, setHeader: (key: string, value: unknown) => values.set(key.toLowerCase(), value), getHeader: (key: string) => values.get(key.toLowerCase()), end: vi.fn() }
  return { res: res as unknown as ServerResponse, headers: values, text: () => String(res.end.mock.calls[0]?.[0] ?? ''), body: () => JSON.parse(String(res.end.mock.calls[0]?.[0] ?? '{}')) }
}
async function http(handler: Handler, ctx: OpenAIAuthContext, { method = 'GET', url = '/', headers = {} }: { method?: string; url?: string; headers?: Record<string, string> } = {}) {
  const output = response()
  await handler({ method, url, headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage, output.res, ctx)
  return output
}
function cookieValue(output: ReturnType<typeof response>, name: string) {
  return (output.headers.get('set-cookie') as string[] | undefined)?.find((value) => value.startsWith(`${name}=`))?.split(';')[0].slice(name.length + 1)
}
async function fixture(extraEnv: Record<string, string | undefined> = {}) {
  let clock = Date.now()
  const store = new MemoryOpenAIAuthStore(() => clock)
  const state = { nonce: '', claims: {} as JWTPayload, badSignature: false, key: 'fixture-key', discovery: { ...DISCOVERY }, tokenStatus: 200, idTokenMissing: false, tokenRequests: [] as RequestInit[], jwksKeys: [jwk] }
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url === OPENAI_AUTH_DISCOVERY_URL) return Response.json(state.discovery)
    if (url === DISCOVERY.jwks_uri) return Response.json({ keys: state.jwksKeys })
    if (url === DISCOVERY.token_endpoint) {
      state.tokenRequests.push(init ?? {})
      if (state.tokenStatus !== 200) return Response.json({ error: 'invalid_client', error_description: 'PRIVATE_PROVIDER_DETAIL' }, { status: state.tokenStatus })
      if (state.idTokenMissing) return Response.json({ access_token: 'fixture-unused-access-token' })
      const seconds = Math.floor(clock / 1000)
      const claims = { iss: OPENAI_AUTH_ISSUER, aud: ENV.OPENAI_SIGN_IN_CLIENT_ID, sub: 'fixture-subject', iat: seconds, exp: seconds + 300, nonce: state.nonce, name: 'Fixture Reader', email: 'reader@example.test', ...state.claims }
      const key = state.badSignature ? wrongSigningKey : state.key === 'rotated-key' ? rotatedSigningKey : signingKey
      return Response.json({ id_token: await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: state.key }).sign(key) })
    }
    throw new Error('Unexpected fixture endpoint')
  }) as unknown as typeof fetch
  const ctx = createOpenAIAuthContext({ ...ENV, ...extraEnv }, { store, fetcher, now: () => clock })
  async function start(headers: Record<string, string> = {}) {
    const result = await http(handleOpenAIAuthStart, ctx, { headers })
    const authorization = new URL(String(result.headers.get('location')))
    state.nonce = authorization.searchParams.get('nonce') ?? ''
    const transactionToken = cookieValue(result, OPENAI_AUTH_TRANSACTION_COOKIE)!
    return { result, authorization, transactionToken, cookie: `${OPENAI_AUTH_TRANSACTION_COOKIE}=${transactionToken}`, state: authorization.searchParams.get('state')! }
  }
  async function complete(previousSessionToken?: string) {
    const tx = await start()
    const cookie = `${tx.cookie}${previousSessionToken ? `; ${OPENAI_AUTH_SESSION_COOKIE}=${previousSessionToken}` : ''}`
    const result = await http(handleOpenAIAuthCallback, ctx, { url: `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`, headers: { cookie } })
    return { result, tx, sessionToken: cookieValue(result, OPENAI_AUTH_SESSION_COOKIE)! }
  }
  return { ctx, store, state, fetcher, start, complete, advance: (ms: number) => { clock += ms }, now: () => clock }
}

describe('OpenAI website identity configuration and HTTP contract', () => {
  it('exports the shared handlers from all four API routes', () => {
    expect([startHandler, callbackHandler, sessionHandler, signoutHandler]).toEqual([handleOpenAIAuthStart, handleOpenAIAuthCallback, handleOpenAIAuthSession, handleOpenAIAuthSignout])
  })
  it.each([
    {}, { ...ENV, OPENAI_SIGN_IN_ENABLED: 'false' }, { ...ENV, OPENAI_SIGN_IN_CLIENT_ID: 'dynamic_agent_client' },
    { ...ENV, OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: undefined }, { ...ENV, OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: 'client_secret_post' },
    { ...ENV, OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: 'client_secret_basic' }, { ...ENV, OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: 'client_secret_basic', OPENAI_CLIENT_SECRET: ' secret' },
    { ...ENV, OPENAI_SIGN_IN_REDIRECT_URI: 'https://other.example/api/auth/openai/callback' },
    { ...ENV, OPENAI_SIGN_IN_REDIRECT_URI: 'https://flowchart.example/api/auth/openai/callback?returnTo=evil' },
    { ...ENV, PUBLIC_BASE_URL: 'http://flowchart.example', OPENAI_SIGN_IN_REDIRECT_URI: 'http://flowchart.example/api/auth/openai/callback' },
    { ...ENV, PUBLIC_BASE_URL: 'https://user:pass@flowchart.example' },
    { ...ENV, PUBLIC_BASE_URL: 'http://localhost:4187', OPENAI_SIGN_IN_REDIRECT_URI: 'http://localhost:4187/api/auth/openai/callback', NODE_ENV: 'production' },
  ])('unavailable configuration never performs provider/storage work: %j', async (env) => {
    const store = new MemoryOpenAIAuthStore()
    const put = vi.spyOn(store, 'putTransaction')
    const read = vi.spyOn(store, 'getSession')
    const fetcher = vi.fn() as unknown as typeof fetch
    const ctx = createOpenAIAuthContext(env, { store, fetcher })
    expect(ctx.available).toBe(false)
    expect((await http(handleOpenAIAuthSession, ctx)).body()).toMatchObject({ available: false, authenticated: false, planUsageAvailable: false })
    expect((await http(handleOpenAIAuthStart, ctx)).res.statusCode).toBe(503)
    expect(fetcher).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
  it('never selects an automatic memory fallback, even with FLOW_STORE=memory', () => {
    expect(createOpenAIAuthContext({ ...ENV, NODE_ENV: 'production', FLOW_STORE: 'memory' }).available).toBe(false)
    expect(createOpenAIAuthContext({ ...ENV, NODE_ENV: 'development' }).available).toBe(false)
  })
  it('permits non-production loopback HTTP fixtures while retaining Secure cookies', async () => {
    const f = await fixture({ PUBLIC_BASE_URL: 'http://127.0.0.1:4187', OPENAI_SIGN_IN_REDIRECT_URI: 'http://127.0.0.1:4187/api/auth/openai/callback', NODE_ENV: 'development' })
    expect(f.ctx.available).toBe(true)
    const tx = await f.start()
    expect(tx.authorization.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4187/api/auth/openai/callback')
    expect(tx.result.headers.get('set-cookie')).toEqual([expect.stringContaining('; HttpOnly; Secure; SameSite=Lax;')])
  })
  it('returns method-specific 405s, no-store/security headers and no permissive CORS', async () => {
    const f = await fixture()
    for (const [handler, method] of [[handleOpenAIAuthStart, 'POST'], [handleOpenAIAuthCallback, 'POST'], [handleOpenAIAuthSession, 'POST'], [handleOpenAIAuthSignout, 'GET']] as const) {
      const result = await http(handler, f.ctx, { method })
      expect(result.res.statusCode).toBe(405)
      expect(result.headers.get('cache-control')).toContain('no-store')
      expect(result.headers.get('x-content-type-options')).toBe('nosniff')
      expect(result.headers.get('referrer-policy')).toBe('no-referrer')
      expect(result.headers.has('access-control-allow-origin')).toBe(false)
    }
  })
  it.each(['https://evil.example/token', 'http://auth.openai.com/token', 'https://auth.openai.com.evil.example/token', 'https://user:password@auth.openai.com/token'])('rejects discovery endpoint outside pinned trust: %s', async (endpoint) => {
    const f = await fixture()
    f.state.discovery.token_endpoint = endpoint
    const result = await http(handleOpenAIAuthStart, f.ctx)
    expect(result.res.statusCode).toBe(503)
    expect(f.state.tokenRequests).toHaveLength(0)
    expect(result.text()).not.toContain(endpoint)
  })
  it('rejects issuer mismatch, ignores issuer env overrides, and rejects cross-site start', async () => {
    const f = await fixture({ OPENAI_SIGN_IN_ISSUER: 'https://evil.example' })
    f.state.discovery.issuer = 'https://evil.example'
    expect((await http(handleOpenAIAuthStart, f.ctx)).res.statusCode).toBe(503)
    expect(vi.mocked(f.fetcher).mock.calls[0][0]).toBe(OPENAI_AUTH_DISCOVERY_URL)
    expect((await http(handleOpenAIAuthStart, f.ctx, { headers: { 'sec-fetch-site': 'cross-site' } })).res.statusCode).toBe(403)
  })
  it('rejects cross-site start before touching an existing transaction or its cookie', async () => {
    const f = await fixture()
    const tx = await f.start()
    const consume = vi.spyOn(f.store, 'consumeTransaction')
    const calls = vi.mocked(f.fetcher).mock.calls.length
    const denied = await http(handleOpenAIAuthStart, f.ctx, { headers: { cookie: tx.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } })
    expect(denied.res.statusCode).toBe(403)
    expect(denied.headers.has('set-cookie')).toBe(false)
    expect(consume).not.toHaveBeenCalled()
    expect(vi.mocked(f.fetcher).mock.calls.length).toBe(calls)
    const result = await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`, headers: { cookie: tx.cookie } })
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=success')
  })
})

describe('One-time OAuth transactions and real signed identity verification', () => {
  it('keeps 64-byte PKCE verifier server-side, uses identity scopes and registered callback; accepts legitimate cross-site callback', async () => {
    const f = await fixture()
    const tx = await f.start({ host: 'evil.example', 'x-forwarded-host': 'evil.example' })
    expect(tx.authorization.origin).toBe(OPENAI_AUTH_ISSUER)
    expect(tx.authorization.searchParams.get('scope')).toBe('openid profile email')
    expect(tx.authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(tx.authorization.searchParams.get('redirect_uri')).toBe(ENV.OPENAI_SIGN_IN_REDIRECT_URI)
    expect(tx.authorization.searchParams.has('code_verifier')).toBe(false)
    const result = await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`, headers: { cookie: tx.cookie, origin: OPENAI_AUTH_ISSUER, 'sec-fetch-site': 'cross-site' } })
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=success')
    const request = f.state.tokenRequests[0]
    const body = new URLSearchParams(request.body as URLSearchParams)
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{86}$/)
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(tx.authorization.searchParams.get('code_challenge'))
    expect(body.get('redirect_uri')).toBe(ENV.OPENAI_SIGN_IN_REDIRECT_URI)
    expect(body.has('client_secret')).toBe(false)
    expect(new Headers(request.headers).has('authorization')).toBe(false)
    expect(request.redirect).toBe('manual')
    expect(result.headers.get('set-cookie')).toEqual([expect.stringContaining(`${OPENAI_AUTH_TRANSACTION_COOKIE}=;`), expect.stringContaining(`${OPENAI_AUTH_SESSION_COOKIE}=`)])
  })
  it.each(['wrong_state', 'wrong_cookie', 'expired', 'missing_state', 'duplicate_state', 'missing_code'])('rejects %s without code exchange', async (failure) => {
    const f = await fixture()
    const tx = await f.start()
    if (failure === 'expired') f.advance(600_001)
    const state = failure === 'wrong_state' ? 'bad-state' : tx.state
    const url = failure === 'missing_state' ? '/api/auth/openai/callback?code=fixture-code' : failure === 'missing_code' ? `/api/auth/openai/callback?state=${state}` : `/api/auth/openai/callback?state=${state}${failure === 'duplicate_state' ? `&state=${state}` : ''}&code=fixture-code`
    const first = await http(handleOpenAIAuthCallback, f.ctx, { url, headers: { cookie: failure === 'wrong_cookie' ? `${OPENAI_AUTH_TRANSACTION_COOKIE}=${'x'.repeat(43)}` : tx.cookie } })
    expect(first.headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(f.state.tokenRequests).toHaveLength(0)
    if (failure !== 'wrong_cookie') {
      const retry = await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`, headers: { cookie: tx.cookie } })
      expect(retry.headers.get('location')).toBe('/?chatgpt_signin=error')
      expect(f.state.tokenRequests).toHaveLength(0)
    }
  })
  it('wrong browser cookie cannot consume another transaction, but valid cancellation consumes once with fixed redirect', async () => {
    const f = await fixture()
    const tx = await f.start()
    const url = `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`
    await http(handleOpenAIAuthCallback, f.ctx, { url, headers: { cookie: `${OPENAI_AUTH_TRANSACTION_COOKIE}=${'x'.repeat(43)}` } })
    expect((await http(handleOpenAIAuthCallback, f.ctx, { url, headers: { cookie: tx.cookie } })).headers.get('location')).toBe('/?chatgpt_signin=success')
    const cancelled = await f.start()
    const result = await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${cancelled.state}&error=access_denied&error_description=PRIVATE&returnTo=https://evil.example`, headers: { cookie: cancelled.cookie } })
    expect(result.headers.get('location')).toBe('/?chatgpt_signin=cancelled')
    expect(result.text()).not.toContain('PRIVATE')
    expect((await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${cancelled.state}&code=fixture-code`, headers: { cookie: cancelled.cookie } })).headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(f.state.tokenRequests).toHaveLength(1)
  })
  it('concurrent callbacks redeem exactly once; later replay and replaced start fail', async () => {
    const f = await fixture()
    const tx = await f.start()
    const input = { url: `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`, headers: { cookie: tx.cookie } }
    const responses = await Promise.all([http(handleOpenAIAuthCallback, f.ctx, input), http(handleOpenAIAuthCallback, f.ctx, input)])
    expect(responses.map((r) => r.headers.get('location')).sort()).toEqual(['/?chatgpt_signin=error', '/?chatgpt_signin=success'])
    expect(f.state.tokenRequests).toHaveLength(1)
    expect((await http(handleOpenAIAuthCallback, f.ctx, input)).headers.get('location')).toBe('/?chatgpt_signin=error')
    const old = await f.start()
    await f.start({ cookie: old.cookie })
    expect((await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${old.state}&code=fixture-code`, headers: { cookie: old.cookie } })).headers.get('location')).toBe('/?chatgpt_signin=error')
  })
  it('uses confidential Basic form-encoded credentials, retains PKCE, never sends body secret or falls back after invalid secret', async () => {
    const f = await fixture({ OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: 'client_secret_basic', OPENAI_CLIENT_SECRET: 'fixture:secret with+symbols' })
    expect((await f.complete()).result.headers.get('location')).toBe('/?chatgpt_signin=success')
    const init = f.state.tokenRequests[0]
    expect(Buffer.from(new Headers(init.headers).get('authorization')!.slice(6), 'base64').toString()).toBe('oaiapp_identity_fixture:fixture%3Asecret+with%2Bsymbols')
    expect(new URLSearchParams(init.body as URLSearchParams).has('client_secret')).toBe(false)
    f.state.tokenStatus = 401
    const failed = await f.complete()
    expect(failed.result.headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(f.state.tokenRequests).toHaveLength(2)
    expect(cookieValue(failed.result, OPENAI_AUTH_SESSION_COOKIE)).toBeUndefined()
    expect(failed.result.text()).not.toContain('PRIVATE_PROVIDER_DETAIL')
  })
  it.each([
    ['issuer', { iss: 'https://evil.example' }], ['audience', { aud: 'oaiapp_other' }], ['expiry', { exp: 1 }], ['nonce', { nonce: 'wrong-nonce' }],
    ['subject', { sub: ' ' }], ['issued_at', { iat: undefined }], ['future_issued_at', { iat: 9_999_999_999 }], ['multi_audience_azp', { aud: [ENV.OPENAI_SIGN_IN_CLIENT_ID, 'oaiapp_other'] }], ['wrong_azp', { azp: 'oaiapp_other' }],
  ])('rejects genuinely signed JWT with invalid %s', async (_name, claims) => {
    const f = await fixture()
    f.state.claims = claims
    const result = await f.complete()
    expect(result.result.headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(result.sessionToken).toBeUndefined()
  })
  it('rejects cryptographically invalid signature and missing id_token without requiring access tokens', async () => {
    const f = await fixture()
    f.state.badSignature = true
    expect((await f.complete()).result.headers.get('location')).toBe('/?chatgpt_signin=error')
    f.state.badSignature = false
    f.state.idTokenMissing = true
    expect((await f.complete()).result.headers.get('location')).toBe('/?chatgpt_signin=error')
  })
  it('rejects oversized upstream JSON and never follows provider redirects', async () => {
    for (const result of [new Response('x'.repeat(65_537)), new Response(null, { status: 302, headers: { location: 'https://evil.example' } })]) {
      const fetcher = vi.fn(async () => result) as unknown as typeof fetch
      const ctx = createOpenAIAuthContext(ENV, { store: new MemoryOpenAIAuthStore(), fetcher })
      expect((await http(handleOpenAIAuthStart, ctx)).res.statusCode).toBe(503)
      expect(vi.mocked(fetcher).mock.calls).toHaveLength(1)
      expect(vi.mocked(fetcher).mock.calls[0][1]?.redirect).toBe('manual')
    }
  })
  it('caches discovery/JWKS and refreshes unfamiliar kid after bounded cooldown', async () => {
    const f = await fixture()
    await f.complete()
    await f.complete()
    const calls = () => vi.mocked(f.fetcher).mock.calls.map(([url]) => String(url))
    expect(calls().filter((url) => url === OPENAI_AUTH_DISCOVERY_URL)).toHaveLength(1)
    expect(calls().filter((url) => url === DISCOVERY.jwks_uri)).toHaveLength(1)
    f.advance(31_000)
    vi.spyOn(Date, 'now').mockImplementation(f.now)
    f.state.jwksKeys = [rotatedJwk]
    f.state.key = 'rotated-key'
    expect((await f.complete()).result.headers.get('location')).toBe('/?chatgpt_signin=success')
    expect(calls().filter((url) => url === DISCOVERY.jwks_uri)).toHaveLength(2)
  })
  it('malformed stored transaction fails closed before code exchange', async () => {
    const f = await fixture()
    const tx = await f.start()
    vi.spyOn(f.store, 'consumeTransaction').mockResolvedValue({ state: tx.state, nonce: f.state.nonce, codeVerifier: 'invalid', redirectUri: ENV.OPENAI_SIGN_IN_REDIRECT_URI, expiresAt: undefined } as unknown as OpenAIAuthTransaction)
    expect((await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`, headers: { cookie: tx.cookie } })).headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(f.state.tokenRequests).toHaveLength(0)
  })
  it('rejects array-backed transaction strings before provider exchange', async () => {
    const f = await fixture()
    const tx = await f.start()
    const key = openAIAuthStorageKey(f.ctx.config!, tx.transactionToken)
    const stored = (await f.store.consumeTransaction(key))!
    const consume = vi.spyOn(f.store, 'consumeTransaction')
    for (const field of ['state', 'nonce', 'codeVerifier'] as const) {
      consume.mockResolvedValueOnce({ ...stored, [field]: [stored[field]] } as unknown as OpenAIAuthTransaction)
      const result = await http(handleOpenAIAuthCallback, f.ctx, { url: `/api/auth/openai/callback?state=${tx.state}&code=fixture-code`, headers: { cookie: tx.cookie } })
      expect(result.headers.get('location')).toBe('/?chatgpt_signin=error')
    }
    expect(f.state.tokenRequests).toHaveLength(0)
  })
})

describe('Isolated first-party website sessions', () => {
  it('missing optional name and email claims remain authenticated nullable profile fields', async () => {
    const f = await fixture()
    f.state.claims = { name: undefined, email: undefined }
    const signed = await f.complete()
    const result = await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: `${OPENAI_AUTH_SESSION_COOKIE}=${signed.sessionToken}` } })
    expect(result.body()).toMatchObject({ authenticated: true, user: { name: null, email: null }, planUsageAvailable: false })
  })
  it('real HTTP routes accept verified cross-site callbacks and enforce session/CSRF lifecycle', async () => {
    const f = await fixture()
    const handlers: Record<string, Handler> = { '/api/auth/openai/start': handleOpenAIAuthStart, '/api/auth/openai/callback': handleOpenAIAuthCallback, '/api/auth/openai/session': handleOpenAIAuthSession, '/api/auth/openai/signout': handleOpenAIAuthSignout }
    const server = createServer(async (req, res) => {
      const handler = handlers[new URL(req.url ?? '/', 'http://fixture').pathname]
      if (!handler) { res.statusCode = 404; res.end(); return }
      await handler(req, res, f.ctx)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const start = await fetch(`${base}/api/auth/openai/start`, { redirect: 'manual', headers: { 'sec-fetch-site': 'none' } })
      expect(start.status).toBe(302)
      const authorize = new URL(start.headers.get('location')!)
      f.state.nonce = authorize.searchParams.get('nonce')!
      const txCookie = start.headers.getSetCookie()[0].split(';')[0]
      const callback = await fetch(`${base}/api/auth/openai/callback?state=${authorize.searchParams.get('state')}&code=fixture-code`, { redirect: 'manual', headers: { cookie: txCookie, origin: OPENAI_AUTH_ISSUER, 'sec-fetch-site': 'cross-site' } })
      expect(callback.status).toBe(302)
      expect(callback.headers.get('location')).toBe('/?chatgpt_signin=success')
      const sessionCookie = callback.headers.getSetCookie().find((value) => value.startsWith(`${OPENAI_AUTH_SESSION_COOKIE}=`))!.split(';')[0]
      const session = await fetch(`${base}/api/auth/openai/session`, { headers: { cookie: sessionCookie } })
      const profile = await session.json()
      expect(profile).toMatchObject({ authenticated: true, planUsageAvailable: false })
      const denied = await fetch(`${base}/api/auth/openai/signout`, { method: 'POST', headers: { cookie: sessionCookie, origin: 'https://evil.example', [OPENAI_AUTH_CSRF_HEADER]: profile.csrfToken } })
      expect(denied.status).toBe(403)
      const signout = await fetch(`${base}/api/auth/openai/signout`, { method: 'POST', headers: { cookie: sessionCookie, origin: ENV.PUBLIC_BASE_URL, [OPENAI_AUTH_CSRF_HEADER]: profile.csrfToken } })
      expect(await signout.json()).toEqual({ signedOut: true })
      expect(signout.headers.getSetCookie()).toEqual([expect.stringContaining(`${OPENAI_AUTH_SESSION_COOKIE}=;`)])
      const ended = await fetch(`${base}/api/auth/openai/session`, { headers: { cookie: sessionCookie } })
      expect(await ended.json()).toMatchObject({ authenticated: false, planUsageAvailable: false })
      expect(f.state.tokenRequests).toHaveLength(1)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
  it('returns minimal identity and CSRF, never raw subject, tokens, identity hash or plan entitlement', async () => {
    const f = await fixture()
    const signed = await f.complete()
    const result = await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: `${OPENAI_AUTH_SESSION_COOKIE}=${signed.sessionToken}` } })
    expect(result.body()).toEqual({ available: true, authenticated: true, user: { name: 'Fixture Reader', email: 'reader@example.test' }, csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/), planUsageAvailable: false, message: expect.stringContaining('plan usage is not available') })
    for (const secret of ['fixture-subject', signed.sessionToken, 'identityHash', 'id_token']) expect(result.text()).not.toContain(secret)
    const stored = await f.store.getSession(openAIAuthStorageKey(f.ctx.config!, signed.sessionToken))
    expect(JSON.stringify(stored)).not.toContain('fixture-subject')
    expect(JSON.stringify(stored)).not.toContain('id_token')
  })
  it('same subject yields stable identity; matching email alone never links different subjects', async () => {
    const f = await fixture()
    const identity = async (token: string) => (await f.ctx.auth!.session(token))!.identityHash
    const first = await f.complete()
    const firstIdentity = await identity(first.sessionToken)
    expect(await identity((await f.complete()).sessionToken)).toBe(firstIdentity)
    f.state.claims = { sub: 'different-subject', email: 'reader@example.test' }
    expect(await identity((await f.complete()).sessionToken)).not.toBe(firstIdentity)
  })
  it('rotates/deletes the presented old session without touching other cookies', async () => {
    const f = await fixture()
    const first = await f.complete()
    const next = await f.complete(first.sessionToken)
    expect(next.result.headers.get('location')).toBe('/?chatgpt_signin=success')
    expect(next.sessionToken).not.toBe(first.sessionToken)
    expect(await f.ctx.auth!.session(first.sessionToken)).toBeNull()
    expect(await f.ctx.auth!.session(next.sessionToken)).not.toBeNull()
    expect((next.result.headers.get('set-cookie') as string[]).every((value) => value.startsWith('__Host-flowchart_openai_'))).toBe(true)
  })
  it('expires eight-hour sessions and rejects revoked or malformed records', async () => {
    const f = await fixture()
    const first = await f.complete()
    f.advance(28_800_001)
    expect((await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: `${OPENAI_AUTH_SESSION_COOKIE}=${first.sessionToken}` } })).body().authenticated).toBe(false)
    const second = await f.complete()
    await f.store.deleteSession(openAIAuthStorageKey(f.ctx.config!, second.sessionToken))
    expect(await f.ctx.auth!.session(second.sessionToken)).toBeNull()
    vi.spyOn(f.store, 'getSession').mockResolvedValue({ expiresAt: undefined } as unknown as OpenAIAuthSession)
    expect((await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: `${OPENAI_AUTH_SESSION_COOKIE}=${second.sessionToken}` } })).body().authenticated).toBe(false)
  })
  it('rejects array-backed session identity/CSRF fields rather than coercing them', async () => {
    const f = await fixture()
    const signed = await f.complete()
    const stored = (await f.ctx.auth!.session(signed.sessionToken))!
    const read = vi.spyOn(f.store, 'getSession')
    for (const field of ['identityHash', 'csrfToken'] as const) {
      read.mockResolvedValueOnce({ ...stored, [field]: [stored[field]] } as unknown as OpenAIAuthSession)
      const result = await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: `${OPENAI_AUTH_SESSION_COOKIE}=${signed.sessionToken}` } })
      expect(result.body().authenticated).toBe(false)
      expect(result.body().csrfToken).toBeUndefined()
    }
  })
  it('rejects cross-origin inspection, duplicate and malformed cookies', async () => {
    const f = await fixture()
    const first = await f.complete()
    const value = `${OPENAI_AUTH_SESSION_COOKIE}=${first.sessionToken}`
    expect((await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: value, origin: 'https://evil.example' } })).res.statusCode).toBe(403)
    expect((await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: value, 'sec-fetch-site': 'cross-site' } })).res.statusCode).toBe(403)
    expect((await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: `${value}; ${value}` } })).body().authenticated).toBe(false)
    expect((await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie: `${OPENAI_AUTH_SESSION_COOKIE}=not-valid` } })).body().authenticated).toBe(false)
  })
  it('signout requires exact Origin plus CSRF, clears only our session and never contacts provider', async () => {
    const f = await fixture()
    const signed = await f.complete()
    const cookie = `${OPENAI_AUTH_SESSION_COOKIE}=${signed.sessionToken}; premium_session=fixture-billing; other_session=fixture-other`
    const session = (await http(handleOpenAIAuthSession, f.ctx, { headers: { cookie } })).body()
    for (const headers of [{ cookie, [OPENAI_AUTH_CSRF_HEADER]: session.csrfToken }, { cookie, origin: 'https://evil.example', [OPENAI_AUTH_CSRF_HEADER]: session.csrfToken }, { cookie, origin: ENV.PUBLIC_BASE_URL }, { cookie, origin: ENV.PUBLIC_BASE_URL, [OPENAI_AUTH_CSRF_HEADER]: 'x'.repeat(43) }]) {
      expect((await http(handleOpenAIAuthSignout, f.ctx, { method: 'POST', headers })).res.statusCode).toBe(403)
      expect(await f.ctx.auth!.session(signed.sessionToken)).not.toBeNull()
    }
    const calls = vi.mocked(f.fetcher).mock.calls.length
    const result = await http(handleOpenAIAuthSignout, f.ctx, { method: 'POST', headers: { cookie, origin: ENV.PUBLIC_BASE_URL, [OPENAI_AUTH_CSRF_HEADER]: session.csrfToken } })
    expect(result.body()).toEqual({ signedOut: true })
    expect(result.headers.get('set-cookie')).toEqual([expect.stringContaining(`${OPENAI_AUTH_SESSION_COOKIE}=;`)])
    expect(await f.ctx.auth!.session(signed.sessionToken)).toBeNull()
    expect(vi.mocked(f.fetcher).mock.calls.length).toBe(calls)
  })
  it('storage outage fails closed without false signout, and failed rotation rolls back new session', async () => {
    const f = await fixture()
    const signed = await f.complete()
    const session = await f.ctx.auth!.session(signed.sessionToken)
    const deletion = vi.spyOn(f.store, 'deleteSession').mockRejectedValueOnce(new Error('PRIVATE_REDIS_CREDENTIAL'))
    const result = await http(handleOpenAIAuthSignout, f.ctx, { method: 'POST', headers: { cookie: `${OPENAI_AUTH_SESSION_COOKIE}=${signed.sessionToken}`, origin: ENV.PUBLIC_BASE_URL, [OPENAI_AUTH_CSRF_HEADER]: session!.csrfToken } })
    expect(result.res.statusCode).toBe(503)
    expect(result.headers.has('set-cookie')).toBe(false)
    expect(result.text()).not.toContain('PRIVATE_REDIS_CREDENTIAL')
    deletion.mockRejectedValueOnce(new Error('rotation unavailable'))
    const next = await f.complete(signed.sessionToken)
    expect(next.result.headers.get('location')).toBe('/?chatgpt_signin=error')
    expect(next.sessionToken).toBeUndefined()
    expect(await f.ctx.auth!.session(signed.sessionToken)).not.toBeNull()
  })
  it('rate-limits before additional provider work and supports malformed Unicode comparisons', async () => {
    const f = await fixture()
    for (let i = 0; i < 20; i++) expect((await http(handleOpenAIAuthStart, f.ctx)).res.statusCode).toBe(302)
    const calls = vi.mocked(f.fetcher).mock.calls.length
    const limited = await http(handleOpenAIAuthStart, f.ctx)
    expect(limited.res.statusCode).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('600')
    expect(vi.mocked(f.fetcher).mock.calls.length).toBe(calls)
    expect(authValuesMatch('é'.repeat(43), 'x'.repeat(43))).toBe(false)
  })
})

describe('Redis atomic consume and TTL contract', () => {
  it('one Lua GET+DEL call per consumer prevents races, keys are hashes, records get explicit TTLs', async () => {
    const entries = new Map<string, string>()
    const evalCall = vi.fn(async (script: string, keys: string[], args: string[]) => {
      const key = keys[0]
      if (script === OPENAI_AUTH_PUT_SCRIPT) { if (entries.has(key)) return 0; entries.set(key, args[0]); return 1 }
      if (script === OPENAI_AUTH_CONSUME_SCRIPT) { const value = entries.get(key) ?? null; entries.delete(key); return value }
      if (script === OPENAI_AUTH_READ_SCRIPT) return entries.get(key) ?? null
      if (script === OPENAI_AUTH_DELETE_SCRIPT) { entries.delete(key); return 1 }
      throw new Error('Unrecognized Redis script')
    })
    const store = new RedisOpenAIAuthStore({ eval: evalCall })
    const key = 'a'.repeat(64)
    const tx: OpenAIAuthTransaction = { state: 'fixture-state', nonce: 'fixture-nonce', codeVerifier: 'fixture-server-verifier', redirectUri: ENV.OPENAI_SIGN_IN_REDIRECT_URI, expiresAt: Date.now() + 600_000 }
    expect(await store.putTransaction(key, tx, 600)).toBe(true)
    expect((await Promise.all([store.consumeTransaction(key), store.consumeTransaction(key)])).filter(Boolean)).toEqual([tx])
    expect(evalCall.mock.calls.filter(([script]) => script === OPENAI_AUTH_CONSUME_SCRIPT)).toHaveLength(2)
    expect(OPENAI_AUTH_CONSUME_SCRIPT).toContain("redis.call('GET'")
    expect(OPENAI_AUTH_CONSUME_SCRIPT).toContain("redis.call('DEL'")
    expect(evalCall.mock.calls[0][2][1]).toBe('600')
    expect(evalCall.mock.calls[0][1][0]).not.toContain(tx.state)
    const session: OpenAIAuthSession = { identityHash: 'b'.repeat(64), user: { name: null, email: null }, csrfToken: 'fixture-csrf', expiresAt: Date.now() + 28_800_000 }
    expect(await store.putSession(key, session, 28_800)).toBe(true)
    expect(await store.getSession(key)).toEqual(session)
    await store.deleteSession(key)
    expect(await store.getSession(key)).toBeNull()
    expect(evalCall.mock.calls.find(([script, keys]) => script === OPENAI_AUTH_PUT_SCRIPT && keys[0].includes(':session:'))?.[2][1]).toBe('28800')
    await expect(store.getSession('raw-cookie')).rejects.toThrow('Invalid auth storage key')
  })
  it('session namespaces differ across clients; expired rate entries really reset', async () => {
    const cfg = openAIAuthConfigFromEnv(ENV)!
    expect(openAIAuthStorageKey(cfg, 'same-cookie')).not.toBe(openAIAuthStorageKey({ ...cfg, clientId: 'oaiapp_other' }, 'same-cookie'))
    let now = 1000
    const store = new MemoryOpenAIAuthStore(() => now)
    expect(await store.consumeRate('same', 1, 1)).toBe(true)
    expect(await store.consumeRate('same', 1, 1)).toBe(false)
    now = 2001
    expect(await store.consumeRate('same', 1, 1)).toBe(true)
    expect(await store.consumeRate('same', 1, 1)).toBe(false)
  })
})
