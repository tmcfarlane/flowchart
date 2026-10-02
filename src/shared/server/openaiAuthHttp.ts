import type { IncomingMessage, ServerResponse } from 'node:http'
import { openAIAuthConfigFromEnv, type OpenAIAuthConfig, type OpenAIAuthEnv } from './openaiAuthConfig.js'
import { OpenAIAuthService, OpenAIAuthError, OPENAI_AUTH_COOKIE_PATTERN, OPENAI_AUTH_TRANSACTION_SECONDS, OPENAI_AUTH_SESSION_SECONDS, OPENAI_AUTH_PLAN_MESSAGE, OPENAI_AUTH_UNAVAILABLE_MESSAGE } from './openaiAuthService.js'
import { RedisOpenAIAuthStore, type OpenAIAuthStore } from './openaiAuthStore.js'
import { redisClient, resolveRedisConfig } from './store.js'
import { clientIp } from './http.js'

export const OPENAI_AUTH_TRANSACTION_COOKIE = '__Host-flowchart_openai_tx'
export const OPENAI_AUTH_SESSION_COOKIE = '__Host-flowchart_openai_session'
export const OPENAI_AUTH_CSRF_HEADER = 'x-openai-auth-csrf'
export interface OpenAIAuthContext { env: OpenAIAuthEnv; available: boolean; config: OpenAIAuthConfig | null; auth: OpenAIAuthService | null }
export function createOpenAIAuthContext(env: OpenAIAuthEnv = process.env, overrides: { store?: OpenAIAuthStore; fetcher?: typeof fetch; now?: () => number } = {}): OpenAIAuthContext {
  const config = openAIAuthConfigFromEnv(env)
  if (!config) return { env, available: false, config: null, auth: null }
  try {
    const redis = resolveRedisConfig(env)
    const store = overrides.store ?? (redis ? new RedisOpenAIAuthStore(redisClient(redis)) : null)
    // No memory/file fallback, including production FLOW_STORE=memory settings.
    if (!store) return { env, available: false, config: null, auth: null }
    return { env, available: true, config, auth: new OpenAIAuthService(config, store, overrides.fetcher, overrides.now) }
  } catch { return { env, available: false, config: null, auth: null } }
}
let defaultContext: OpenAIAuthContext | undefined
const context = () => (defaultContext ??= createOpenAIAuthContext())
function headers(res: ServerResponse) {
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Vary', 'Cookie, Origin')
}
function json(res: ServerResponse, status: number, data: unknown) {
  headers(res)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}
function cookie(req: IncomingMessage, name: string): string | undefined {
  const values = (req.headers.cookie ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`))
  if (values.length !== 1) return undefined
  const value = values[0].slice(name.length + 1)
  return OPENAI_AUTH_COOKIE_PATTERN.test(value) ? value : undefined
}
function setCookie(res: ServerResponse, name: string, value: string, seconds: number) {
  const previous = res.getHeader('Set-Cookie')
  const list = previous === undefined ? [] : Array.isArray(previous) ? previous.map(String) : [String(previous)]
  res.setHeader('Set-Cookie', [...list, `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`])
}
function redirect(res: ServerResponse, location: string) { headers(res); res.statusCode = 302; res.setHeader('Location', location); res.end() }
function method(req: IncomingMessage, res: ServerResponse, expected: string): boolean {
  if (req.method === expected) return true
  res.setHeader('Allow', expected)
  json(res, 405, { error: 'This request method is unavailable.', code: 'method_not_allowed' })
  return false
}
function available(res: ServerResponse, ctx: OpenAIAuthContext): ctx is OpenAIAuthContext & { auth: OpenAIAuthService; config: OpenAIAuthConfig } {
  if (ctx.auth && ctx.config) return true
  json(res, 503, { error: OPENAI_AUTH_UNAVAILABLE_MESSAGE, code: 'sign_in_unavailable', planUsageAvailable: false })
  return false
}
function sameOrigin(req: IncomingMessage, ctx: OpenAIAuthContext, mutation: boolean) {
  const origin = req.headers.origin
  const site = req.headers['sec-fetch-site']
  if ((origin !== undefined && origin !== ctx.config?.origin) || (site !== undefined && site !== 'same-origin' && site !== 'none') || (mutation && origin !== ctx.config?.origin)) throw new OpenAIAuthError(403, 'origin_rejected', 'Open this website to manage its sign-in session.')
}
function fail(res: ServerResponse, error: unknown) {
  if (error instanceof OpenAIAuthError) {
    if (error.status === 429) res.setHeader('Retry-After', '600')
    return json(res, error.status, { error: error.message, code: error.code, planUsageAvailable: false })
  }
  // Never expose provider bodies, token/secret values, cookies, or thrown errors.
  return json(res, 503, { error: 'Website sign-in is temporarily unavailable. Please try again later.', code: 'sign_in_unavailable', planUsageAvailable: false })
}
export async function handleOpenAIAuthStart(req: IncomingMessage, res: ServerResponse, ctx = context()) {
  if (!method(req, res, 'GET') || !available(res, ctx)) return
  // Reject cross-site initiation before touching an existing browser transaction.
  try { sameOrigin(req, ctx, false) } catch (error) { fail(res, error); return }
  try {
    await ctx.auth.limit(clientIp(req, ctx.env))
    const result = await ctx.auth.start(cookie(req, OPENAI_AUTH_TRANSACTION_COOKIE))
    setCookie(res, OPENAI_AUTH_TRANSACTION_COOKIE, result.transactionToken, OPENAI_AUTH_TRANSACTION_SECONDS)
    redirect(res, result.authorizationUrl)
  } catch (error) { setCookie(res, OPENAI_AUTH_TRANSACTION_COOKIE, '', 0); fail(res, error) }
}
export async function handleOpenAIAuthCallback(req: IncomingMessage, res: ServerResponse, ctx = context()) {
  if (!method(req, res, 'GET')) return
  if (!ctx.auth || !ctx.config) { redirect(res, '/?chatgpt_signin=error'); return }
  try {
    // Provider callbacks are cross-site top-level navigation. Never apply the
    // website's mutation-origin gate or infer redirect_uri from Host/proxies.
    const params = new URL(req.url ?? '', ctx.config.origin).searchParams
    const result = await ctx.auth.callback(cookie(req, OPENAI_AUTH_TRANSACTION_COOKIE), params, cookie(req, OPENAI_AUTH_SESSION_COOKIE))
    if (result.mutateCookies) {
      setCookie(res, OPENAI_AUTH_TRANSACTION_COOKIE, '', 0)
      if (result.sessionToken) setCookie(res, OPENAI_AUTH_SESSION_COOKIE, result.sessionToken, OPENAI_AUTH_SESSION_SECONDS)
    }
    redirect(res, `/?chatgpt_signin=${result.result}`)
  } catch { redirect(res, '/?chatgpt_signin=error') }
}
export async function handleOpenAIAuthSession(req: IncomingMessage, res: ServerResponse, ctx = context()) {
  if (!method(req, res, 'GET')) return
  if (!ctx.auth || !ctx.config) { json(res, 200, { available: false, authenticated: false, planUsageAvailable: false, message: OPENAI_AUTH_UNAVAILABLE_MESSAGE }); return }
  try {
    sameOrigin(req, ctx, false)
    const session = await ctx.auth.session(cookie(req, OPENAI_AUTH_SESSION_COOKIE))
    if (!session) { setCookie(res, OPENAI_AUTH_SESSION_COOKIE, '', 0); json(res, 200, { available: true, authenticated: false, planUsageAvailable: false, message: OPENAI_AUTH_PLAN_MESSAGE }); return }
    json(res, 200, { available: true, authenticated: true, user: session.user, csrfToken: session.csrfToken, planUsageAvailable: false, message: OPENAI_AUTH_PLAN_MESSAGE })
  } catch (error) { fail(res, error) }
}
export async function handleOpenAIAuthSignout(req: IncomingMessage, res: ServerResponse, ctx = context()) {
  if (!method(req, res, 'POST') || !available(res, ctx)) return
  try {
    sameOrigin(req, ctx, true)
    const token = cookie(req, OPENAI_AUTH_SESSION_COOKIE)
    if (!token) throw new OpenAIAuthError(401, 'not_authenticated', 'The website session has ended. Sign in again if needed.')
    await ctx.auth.signout(token, req.headers[OPENAI_AUTH_CSRF_HEADER])
    setCookie(res, OPENAI_AUTH_SESSION_COOKIE, '', 0)
    json(res, 200, { signedOut: true })
  } catch (error) { fail(res, error) }
}
