import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose'
import { OPENAI_AUTH_DISCOVERY_URL, OPENAI_AUTH_ISSUER, isOpenAIAuthEndpoint, type OpenAIAuthConfig } from './openaiAuthConfig.js'
import type { OpenAIAuthSession, OpenAIAuthStore, OpenAIAuthTransaction } from './openaiAuthStore.js'

export const OPENAI_AUTH_TRANSACTION_SECONDS = 600
export const OPENAI_AUTH_SESSION_SECONDS = 28_800
export const OPENAI_AUTH_UNAVAILABLE_MESSAGE = 'ChatGPT website sign-in is unavailable. It requires an approved OpenAI client and configured secure session storage.'
export const OPENAI_AUTH_PLAN_MESSAGE = 'Signing in identifies you on this website. ChatGPT plan usage is not available here.'
export const OPENAI_AUTH_COOKIE_PATTERN = /^[A-Za-z0-9_-]{43}$/
const random = (bytes = 32) => randomBytes(bytes).toString('base64url')
const validProfileLabel = (value: unknown, max: number) => value === null || (typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value))
function validTransaction(value: OpenAIAuthTransaction | null): value is OpenAIAuthTransaction {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.state === 'string' && OPENAI_AUTH_COOKIE_PATTERN.test(value.state) && typeof value.nonce === 'string' && OPENAI_AUTH_COOKIE_PATTERN.test(value.nonce) && typeof value.codeVerifier === 'string' && /^[A-Za-z0-9_-]{86}$/.test(value.codeVerifier) && Number.isFinite(value.expiresAt)
}
function validSession(value: OpenAIAuthSession | null): value is OpenAIAuthSession {
  return !!value && typeof value === 'object' && !Array.isArray(value) && typeof value.identityHash === 'string' && /^[a-f0-9]{64}$/.test(value.identityHash) && typeof value.csrfToken === 'string' && OPENAI_AUTH_COOKIE_PATTERN.test(value.csrfToken) && Number.isFinite(value.expiresAt) && !!value.user && typeof value.user === 'object' && !Array.isArray(value.user) && validProfileLabel(value.user.name, 200) && validProfileLabel(value.user.email, 320)
}
export function authValuesMatch(a: unknown, b: string): boolean {
  if (typeof a !== 'string' || a.length !== b.length) return false
  const received = Buffer.from(a)
  const expected = Buffer.from(b)
  return received.length === expected.length && timingSafeEqual(received, expected)
}
export function openAIAuthStorageKey(config: OpenAIAuthConfig, token: string): string {
  return createHash('sha256').update(JSON.stringify([OPENAI_AUTH_ISSUER, config.clientId, config.origin, token])).digest('hex')
}
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
export class OpenAIAuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}
export class OpenAIAuthService {
  private discovery?: { value: Discovery; expiresAt: number }
  private loadingDiscovery?: Promise<Discovery>
  private jwks?: { uri: string; resolver: ReturnType<typeof createRemoteJWKSet> }
  constructor(readonly config: OpenAIAuthConfig, readonly store: OpenAIAuthStore, private readonly fetcher: typeof fetch = fetch, readonly now: () => number = Date.now) {}

  private async requestJson(url: string, init: RequestInit = {}, maximumBytes = 65_536): Promise<Record<string, unknown>> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await this.fetcher(url, { ...init, redirect: 'manual', signal: controller.signal })
      if (response.status !== 200 || !response.body) throw new Error('Identity provider unavailable')
      const declaredLength = Number(response.headers.get('content-length') ?? 0)
      if (declaredLength > maximumBytes) { controller.abort(); throw new Error('Identity response too large') }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          length += chunk.value.byteLength
          if (length > maximumBytes) { controller.abort(); await reader.cancel(); throw new Error('Identity response too large') }
          chunks.push(chunk.value)
        }
      } finally { reader.releaseLock() }
      const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid identity response')
      return value as Record<string, unknown>
    } finally { clearTimeout(timer) }
  }
  private async discover(): Promise<Discovery> {
    if (this.discovery && this.discovery.expiresAt > this.now()) return this.discovery.value
    if (!this.loadingDiscovery) {
      this.loadingDiscovery = (async () => {
        const value = await this.requestJson(OPENAI_AUTH_DISCOVERY_URL, { headers: { accept: 'application/json' } })
        if (value.issuer !== OPENAI_AUTH_ISSUER || !isOpenAIAuthEndpoint(value.authorization_endpoint) || !isOpenAIAuthEndpoint(value.token_endpoint) || !isOpenAIAuthEndpoint(value.jwks_uri)) throw new Error('Invalid identity discovery')
        const result = value as unknown as Discovery
        this.discovery = { value: result, expiresAt: this.now() + 600_000 }
        return result
      })()
    }
    try { return await this.loadingDiscovery } finally { this.loadingDiscovery = undefined }
  }
  async limit(ip: string): Promise<void> {
    const window = Math.floor(this.now() / 600_000)
    const key = openAIAuthStorageKey(this.config, `rate:${ip}:${window}`)
    if (!await this.store.consumeRate(key, 20, 660)) throw new OpenAIAuthError(429, 'sign_in_rate_limit', 'Too many sign-in attempts. Try again in ten minutes.')
  }
  async start(previousTransactionToken?: string): Promise<{ transactionToken: string; authorizationUrl: string }> {
    const discovery = await this.discover()
    if (previousTransactionToken) await this.store.consumeTransaction(openAIAuthStorageKey(this.config, previousTransactionToken))
    const token = random()
    const transaction: OpenAIAuthTransaction = { state: random(), nonce: random(), codeVerifier: random(64), redirectUri: this.config.redirectUri, expiresAt: this.now() + OPENAI_AUTH_TRANSACTION_SECONDS * 1000 }
    if (!await this.store.putTransaction(openAIAuthStorageKey(this.config, token), transaction, OPENAI_AUTH_TRANSACTION_SECONDS)) throw new Error('Identity transaction unavailable')
    const url = new URL(discovery.authorization_endpoint)
    // Preserve only the verified discovery endpoint path; discard any existing query.
    url.search = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: transaction.redirectUri, response_type: 'code', scope: 'openid profile email', state: transaction.state, nonce: transaction.nonce, code_challenge: createHash('sha256').update(transaction.codeVerifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
    return { transactionToken: token, authorizationUrl: url.href }
  }
  async callback(token: string | undefined, params: URLSearchParams, previousSessionToken?: string): Promise<{ result: 'success' | 'error' | 'cancelled'; sessionToken?: string }> {
    if (!token) return { result: 'error' }
    // Consumption precedes every validation and provider request; concurrent callbacks
    // can never redeem the same authorization code twice.
    const transaction = await this.store.consumeTransaction(openAIAuthStorageKey(this.config, token))
    if (!validTransaction(transaction) || transaction.expiresAt <= this.now() || transaction.redirectUri !== this.config.redirectUri || params.getAll('state').length !== 1 || !authValuesMatch(params.get('state'), transaction.state)) return { result: 'error' }
    if (params.has('error')) return { result: params.getAll('error').length === 1 && params.get('error') === 'access_denied' ? 'cancelled' : 'error' }
    const code = params.get('code')
    if (params.getAll('code').length !== 1 || !code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code)) return { result: 'error' }
    const discovery = await this.discover()
    const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }
    if (this.config.tokenAuthMethod === 'client_secret_basic') {
      if (!this.config.clientSecret) throw new Error('Confidential identity client unavailable')
      const encode = (value: string) => new URLSearchParams({ value }).toString().slice(6)
      headers.authorization = `Basic ${Buffer.from(`${encode(this.config.clientId)}:${encode(this.config.clientSecret)}`).toString('base64')}`
    }
    const tokens = await this.requestJson(discovery.token_endpoint, { method: 'POST', headers, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: transaction.redirectUri, client_id: this.config.clientId, code_verifier: transaction.codeVerifier }) })
    if (typeof tokens.id_token !== 'string' || tokens.id_token.length > 16_384) throw new Error('Invalid identity token response')
    if (!this.jwks || this.jwks.uri !== discovery.jwks_uri) {
      this.jwks = { uri: discovery.jwks_uri, resolver: createRemoteJWKSet(new URL(discovery.jwks_uri), { timeoutDuration: 5000, cacheMaxAge: 600_000, cooldownDuration: 30_000, [customFetch]: async (url) => new Response(JSON.stringify(await this.requestJson(url, { headers: { accept: 'application/json' } })), { status: 200, headers: { 'content-type': 'application/json' } }) }) }
    }
    const { payload } = await jwtVerify(tokens.id_token, this.jwks.resolver, { issuer: OPENAI_AUTH_ISSUER, audience: this.config.clientId, algorithms: ['RS256', 'ES256'], requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp', 'nonce'], clockTolerance: 5, currentDate: new Date(this.now()), maxTokenAge: '10m' })
    if (!authValuesMatch(payload.nonce, transaction.nonce) || typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 1024 || typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || payload.exp <= payload.iat || payload.iat > this.now() / 1000 + 5) throw new Error('Invalid identity claims')
    // OIDC requires azp for a token with multiple audiences, and a supplied azp
    // must identify our client even when aud also contains it.
    if ((Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== this.config.clientId) || (payload.azp !== undefined && payload.azp !== this.config.clientId)) throw new Error('Invalid authorized party')
    const label = (value: unknown, max: number) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x1f\x7f]/.test(value) ? value.trim() : null
    const session: OpenAIAuthSession = { identityHash: createHash('sha256').update(JSON.stringify([OPENAI_AUTH_ISSUER, this.config.clientId, payload.sub])).digest('hex'), user: { name: label(payload.name, 200), email: label(payload.email, 320) }, csrfToken: random(), expiresAt: this.now() + OPENAI_AUTH_SESSION_SECONDS * 1000 }
    const sessionToken = random()
    const sessionKey = openAIAuthStorageKey(this.config, sessionToken)
    if (!await this.store.putSession(sessionKey, session, OPENAI_AUTH_SESSION_SECONDS)) throw new Error('Identity session unavailable')
    try {
      if (previousSessionToken) await this.store.deleteSession(openAIAuthStorageKey(this.config, previousSessionToken))
    } catch {
      await this.store.deleteSession(sessionKey)
      throw new Error('Identity session rotation unavailable')
    }
    return { result: 'success', sessionToken }
  }
  async session(token: string | undefined): Promise<OpenAIAuthSession | null> {
    if (!token) return null
    const key = openAIAuthStorageKey(this.config, token)
    const value = await this.store.getSession(key)
    if (!value) return null
    if (!validSession(value) || value.expiresAt <= this.now()) { await this.store.deleteSession(key); return null }
    return value
  }
  async signout(token: string, csrf: unknown): Promise<void> {
    const session = await this.session(token)
    if (!session) throw new OpenAIAuthError(401, 'not_authenticated', 'The website session has ended. Sign in again if needed.')
    if (!authValuesMatch(csrf, session.csrfToken)) throw new OpenAIAuthError(403, 'csrf_rejected', 'Refresh this website before signing out.')
    await this.store.deleteSession(openAIAuthStorageKey(this.config, token))
  }
}
