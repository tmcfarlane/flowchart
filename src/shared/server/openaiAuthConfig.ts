import { isProductionEnv } from './store.js'

export type OpenAIAuthEnv = Record<string, string | undefined>
export const OPENAI_AUTH_ISSUER = 'https://auth.openai.com'
export const OPENAI_AUTH_DISCOVERY_URL = `${OPENAI_AUTH_ISSUER}/.well-known/openid-configuration`
export const OPENAI_AUTH_CALLBACK_PATH = '/api/auth/openai/callback'
export interface OpenAIAuthConfig {
  clientId: string
  redirectUri: string
  origin: string
  tokenAuthMethod: 'none' | 'client_secret_basic'
  clientSecret?: string
}

export function openAIAuthConfigFromEnv(env: OpenAIAuthEnv): OpenAIAuthConfig | null {
  if (env.OPENAI_SIGN_IN_ENABLED !== 'true') return null
  const clientId = env.OPENAI_SIGN_IN_CLIENT_ID
  const method = env.OPENAI_SIGN_IN_TOKEN_AUTH_METHOD
  if (!clientId || !/^oaiapp_[A-Za-z0-9_-]{1,200}$/.test(clientId) || (method !== 'none' && method !== 'client_secret_basic')) return null
  const secret = env.OPENAI_CLIENT_SECRET
  if (method === 'client_secret_basic' && (!secret || secret.trim() !== secret || secret.length > 4096 || /[\x00-\x1f\x7f]/.test(secret))) return null
  try {
    const publicUrl = new URL(env.PUBLIC_BASE_URL ?? '')
    const redirect = new URL(env.OPENAI_SIGN_IN_REDIRECT_URI ?? '')
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(publicUrl.hostname)
    if (publicUrl.protocol !== 'https:' && !(publicUrl.protocol === 'http:' && loopback && !isProductionEnv(env))) return null
    if (publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash || publicUrl.pathname !== '/') return null
    if (redirect.origin !== publicUrl.origin || redirect.pathname !== OPENAI_AUTH_CALLBACK_PATH || redirect.search || redirect.hash || redirect.username || redirect.password) return null
    if (redirect.href !== env.OPENAI_SIGN_IN_REDIRECT_URI) return null
    return { clientId, origin: publicUrl.origin, redirectUri: redirect.href, tokenAuthMethod: method, ...(method === 'client_secret_basic' ? { clientSecret: secret } : {}) }
  } catch { return null }
}

/** Provider endpoints come only from the fixed discovery document. */
export function isOpenAIAuthEndpoint(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.origin === OPENAI_AUTH_ISSUER && url.protocol === 'https:' && !url.username && !url.password && !url.hash
  } catch { return false }
}
