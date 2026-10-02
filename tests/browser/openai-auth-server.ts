/** Loopback-only test server. No provider credentials or production env are read. */
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import {
  createOpenAIAuthContext, handleOpenAIAuthStart, handleOpenAIAuthCallback,
  handleOpenAIAuthSession, handleOpenAIAuthSignout,
} from '../../src/shared/server/openaiAuthHttp.js'
import { MemoryOpenAIAuthStore } from '../../src/shared/server/openaiAuthStore.js'
import { prepareVercelStyleRequest } from '../../src/shared/server/nodeAdapter.js'

const port = Number(process.env.FLOWCHART_AUTH_BROWSER_PORT ?? 4187)
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('Invalid fixture port')
const origin = `http://127.0.0.1:${port}`
const callback = `${origin}/api/auth/openai/callback`
const clientId = 'oaiapp_browser_fixture'
const issuer = 'https://auth.openai.com'
const discovery = `${issuer}/.well-known/openid-configuration`
const authorize = `${issuer}/api/accounts/authorize`
const token = `${issuer}/api/accounts/oauth/token`
const jwks = `${issuer}/.well-known/jwks.json`
const { publicKey, privateKey } = await generateKeyPair('RS256')
const publicJwk = { ...await exportJWK(publicKey), alg: 'RS256', use: 'sig', kid: 'browser-fixture' }
interface Grant { nonce: string; challenge: string; redirectUri: string }
const codes = new Map<string, Grant>()
const stats = { discovery: 0, jwks: 0, tokenExchanges: 0, issuedCodes: 0, rejectedExchanges: 0, unexpectedUpstream: 0, proxyBlocks: 0 }
const hash = (value: string) => createHash('sha256').update(value).digest('base64url')
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

const fetcher: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url === discovery) {
    stats.discovery++
    return response({ issuer, authorization_endpoint: authorize, token_endpoint: token, jwks_uri: jwks,
      id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'] })
  }
  if (url === jwks) { stats.jwks++; return response({ keys: [publicJwk] }) }
  if (url === token && init?.method === 'POST') {
    stats.tokenExchanges++
    const body = new URLSearchParams(String(init.body ?? ''))
    const code = body.get('code') ?? ''
    const grant = codes.get(code)
    codes.delete(code)
    if (!grant || body.get('grant_type') !== 'authorization_code' || body.get('client_id') !== clientId ||
      body.get('redirect_uri') !== grant.redirectUri || hash(body.get('code_verifier') ?? '') !== grant.challenge ||
      new Headers(init.headers).has('authorization') || body.has('client_secret')) {
      stats.rejectedExchanges++
      return response({ error: 'invalid_grant' }, 400)
    }
    const now = Math.floor(Date.now() / 1000)
    const idToken = await new SignJWT({ nonce: grant.nonce, name: 'Test Diagrammer', email: 'diagrammer@example.test', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'browser-fixture' }).setIssuer(issuer).setAudience(clientId)
      .setSubject('browser-test-subject').setIssuedAt(now).setExpirationTime(now + 300).sign(privateKey)
    // Identity-only contract deliberately contains no access/refresh token.
    return response({ id_token: idToken })
  }
  stats.unexpectedUpstream++
  throw new Error('Unexpected fixture upstream request; never forwarded')
}
const env = { OPENAI_SIGN_IN_ENABLED: 'true', OPENAI_SIGN_IN_CLIENT_ID: clientId,
  OPENAI_SIGN_IN_REDIRECT_URI: callback, OPENAI_SIGN_IN_TOKEN_AUTH_METHOD: 'none', PUBLIC_BASE_URL: origin, NODE_ENV: 'test' }
const configured = createOpenAIAuthContext(env, { store: new MemoryOpenAIAuthStore(), fetcher })
const unavailable = createOpenAIAuthContext({ NODE_ENV: 'test' }, { fetcher })
const handlers = new Map([
  ['/api/auth/openai/start', handleOpenAIAuthStart], ['/api/auth/openai/callback', handleOpenAIAuthCallback],
  ['/api/auth/openai/session', handleOpenAIAuthSession], ['/api/auth/openai/signout', handleOpenAIAuthSignout],
])
const staticRoot = resolve('.browser-auth-test-dist')
const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' }

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', origin)
    res.setHeader('Cache-Control', 'no-store')
    if (url.pathname === '/__test/status' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ ...stats, transport: 'Injected signed OIDC fixture; zero real provider requests' }))
    }
    if (url.pathname === '/__test/issue-code' && req.method === 'POST') {
      await prepareVercelStyleRequest(req, {}, 8192)
      const body = (req as typeof req & { body?: unknown }).body
      if (!body || typeof body !== 'object' || !('authorizationUrl' in body) || typeof body.authorizationUrl !== 'string') throw new Error('Invalid fixture authorization')
      const authorization = new URL(body.authorizationUrl)
      const params = authorization.searchParams
      if (authorization.origin + authorization.pathname !== authorize || params.get('client_id') !== clientId || params.get('redirect_uri') !== callback ||
        params.get('response_type') !== 'code' || params.get('scope') !== 'openid profile email' || params.get('code_challenge_method') !== 'S256' ||
        !params.get('nonce') || !params.get('state') || !params.get('code_challenge')) throw new Error('Invalid fixture contract')
      const code = randomBytes(32).toString('base64url')
      codes.set(code, { nonce: params.get('nonce')!, challenge: params.get('code_challenge')!, redirectUri: callback })
      stats.issuedCodes++
      const target = new URL(callback)
      target.search = new URLSearchParams({ code, state: params.get('state')! }).toString()
      res.setHeader('Content-Type', 'application/json')
      return res.end(JSON.stringify({ callbackUrl: target.href }))
    }
    const handler = handlers.get(url.pathname)
    if (handler) {
      await prepareVercelStyleRequest(req)
      // Test-only fixture selector. No shipped application route recognizes it.
      const context = req.headers['x-flowchart-auth-fixture'] === 'configured' ? configured : unavailable
      return await handler(req, res, context)
    }
    if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method ?? '')) {
      res.statusCode = 404
      return res.end('Fixture does not expose this route')
    }
    const pathname = url.pathname === '/' || url.pathname.startsWith('/f/') ? '/index.html' : decodeURIComponent(url.pathname)
    const file = resolve(staticRoot, '.' + pathname)
    if (!file.startsWith(staticRoot + sep) || pathname.endsWith('.mjs')) { res.statusCode = 404; return res.end() }
    const bytes = await readFile(file)
    res.setHeader('Content-Type', contentTypes[extname(file)] ?? 'application/octet-stream')
    res.end(req.method === 'HEAD' ? undefined : bytes)
  } catch {
    res.statusCode = 500
    res.end('Authentication fixture request failed')
  }
})
// It has no forwarding code and never connects to a destination. Browser
// background requests and missed redirect interception stop here as well.
const denyProxy = createServer((_req, res) => { stats.proxyBlocks++; res.writeHead(403); res.end('External network disabled in authentication fixture') })
denyProxy.on('connect', (_req, socket) => { stats.proxyBlocks++; socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n') })
denyProxy.listen(port + 1, '127.0.0.1', () => server.listen(port, '127.0.0.1'))
const close = () => {
  denyProxy.close(); denyProxy.closeAllConnections()
  server.close(() => process.exit(0)); server.closeAllConnections()
}
process.once('SIGTERM', close)
process.once('SIGINT', close)
