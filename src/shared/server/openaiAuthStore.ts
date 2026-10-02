/** Isolated identity storage. Keys are hashes of opaque browser capabilities. */
export interface OpenAIAuthTransaction {
  state: string
  nonce: string
  codeVerifier: string
  redirectUri: string
  expiresAt: number
}
export interface OpenAIAuthSession {
  identityHash: string
  user: { name: string | null; email: string | null }
  csrfToken: string
  expiresAt: number
}
export interface OpenAIAuthStore {
  putTransaction(key: string, value: OpenAIAuthTransaction, ttlSeconds: number): Promise<boolean>
  /** GET + DELETE is one atomic operation, including rejected callbacks. */
  consumeTransaction(key: string): Promise<OpenAIAuthTransaction | null>
  putSession(key: string, value: OpenAIAuthSession, ttlSeconds: number): Promise<boolean>
  getSession(key: string): Promise<OpenAIAuthSession | null>
  deleteSession(key: string): Promise<void>
  consumeRate(key: string, limit: number, ttlSeconds: number): Promise<boolean>
}

/** Explicitly injected by tests only; never selected from environment settings. */
export class MemoryOpenAIAuthStore implements OpenAIAuthStore {
  private entries = new Map<string, { value: string; expiresAt: number }>()
  constructor(private readonly now: () => number = Date.now) {}
  private read(key: string): string | null {
    const entry = this.entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= this.now()) { this.entries.delete(key); return null }
    return entry.value
  }
  private put(key: string, value: unknown, ttl: number): boolean {
    if (this.read(key) !== null) return false
    this.entries.set(key, { value: JSON.stringify(value), expiresAt: this.now() + ttl * 1000 })
    return true
  }
  async putTransaction(key: string, value: OpenAIAuthTransaction, ttl: number) { return this.put(`tx:${key}`, value, ttl) }
  async consumeTransaction(key: string): Promise<OpenAIAuthTransaction | null> {
    const value = this.read(`tx:${key}`)
    this.entries.delete(`tx:${key}`)
    return value === null ? null : JSON.parse(value)
  }
  async putSession(key: string, value: OpenAIAuthSession, ttl: number) { return this.put(`session:${key}`, value, ttl) }
  async getSession(key: string): Promise<OpenAIAuthSession | null> {
    const value = this.read(`session:${key}`)
    return value === null ? null : JSON.parse(value)
  }
  async deleteSession(key: string) { this.entries.delete(`session:${key}`) }
  async consumeRate(key: string, limit: number, ttl: number) {
    const current = Number(this.read(`rate:${key}`) ?? 0)
    if (current >= limit) return false
    const existing = this.entries.get(`rate:${key}`)
    this.entries.set(`rate:${key}`, { value: String(current + 1), expiresAt: existing?.expiresAt ?? this.now() + ttl * 1000 })
    return true
  }
}

export interface OpenAIAuthRedis { eval(script: string, keys: string[], args: string[]): Promise<unknown> }
export const OPENAI_AUTH_PUT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
`
export const OPENAI_AUTH_CONSUME_SCRIPT = `
local value = redis.call('GET', KEYS[1])
redis.call('DEL', KEYS[1])
return value
`
export const OPENAI_AUTH_READ_SCRIPT = `return redis.call('GET', KEYS[1])`
export const OPENAI_AUTH_DELETE_SCRIPT = `return redis.call('DEL', KEYS[1])`
export const OPENAI_AUTH_RATE_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count >= tonumber(ARGV[1]) then return 0 end
count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
return 1
`

export class RedisOpenAIAuthStore implements OpenAIAuthStore {
  constructor(private readonly redis: OpenAIAuthRedis, private readonly prefix = 'flowchart:openai-auth:') {}
  private key(type: string, key: string) {
    // No caller-supplied raw identifiers or cookie values can become Redis keys.
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid auth storage key')
    return `${this.prefix}${type}:${key}`
  }
  private async put(type: string, key: string, value: unknown, ttl: number) {
    return Number(await this.redis.eval(OPENAI_AUTH_PUT_SCRIPT, [this.key(type, key)], [JSON.stringify(value), String(ttl)])) === 1
  }
  private parse<T>(value: unknown): T | null {
    if (value === null || value === undefined || value === false) return null
    return (typeof value === 'string' ? JSON.parse(value) : value) as T
  }
  async putTransaction(key: string, value: OpenAIAuthTransaction, ttl: number) { return this.put('tx', key, value, ttl) }
  async consumeTransaction(key: string): Promise<OpenAIAuthTransaction | null> {
    return this.parse(await this.redis.eval(OPENAI_AUTH_CONSUME_SCRIPT, [this.key('tx', key)], []))
  }
  async putSession(key: string, value: OpenAIAuthSession, ttl: number) { return this.put('session', key, value, ttl) }
  async getSession(key: string): Promise<OpenAIAuthSession | null> {
    return this.parse(await this.redis.eval(OPENAI_AUTH_READ_SCRIPT, [this.key('session', key)], []))
  }
  async deleteSession(key: string) { await this.redis.eval(OPENAI_AUTH_DELETE_SCRIPT, [this.key('session', key)], []) }
  async consumeRate(key: string, limit: number, ttl: number) {
    return Number(await this.redis.eval(OPENAI_AUTH_RATE_SCRIPT, [this.key('rate', key)], [String(limit), String(ttl)])) === 1
  }
}
