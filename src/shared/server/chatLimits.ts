/** Cost controls for the website's anonymous diagram assistant. Counters and
 * in-flight leases are shared in Redis in production and always fail closed. */
import { createHash, randomUUID } from 'node:crypto'
import { isProductionEnv, redisClient, resolveRedisConfig } from './store.js'
import { clientKey } from './rateLimit.js'

export class ChatLimitError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly retryAfter = 0) { super(message) }
}
export interface ChatReservation { release(): Promise<void> }
export interface ChatLimiter { acquire(client: string): Promise<ChatReservation> }
export interface ChatLimitConfig { perMinute: number; perHour: number; perDayGlobal: number; inFlightPerClient: number; inFlightGlobal: number }
const DEFAULTS: ChatLimitConfig = { perMinute: 6, perHour: 40, perDayGlobal: 300, inFlightPerClient: 2, inFlightGlobal: 10 }
function integer(value: string | undefined, fallback: number, maximum: number) {
  const number = Number(value ?? fallback)
  return Number.isInteger(number) && number > 0 && number <= maximum ? number : fallback
}
export function chatLimitConfigFromEnv(env: Record<string, string | undefined>): ChatLimitConfig {
  return {
    perMinute: integer(env.CHAT_LIMIT_PER_MINUTE, DEFAULTS.perMinute, 1000),
    perHour: integer(env.CHAT_LIMIT_PER_HOUR, DEFAULTS.perHour, 10000),
    perDayGlobal: integer(env.CHAT_BUDGET_PER_DAY, DEFAULTS.perDayGlobal, 100000),
    inFlightPerClient: integer(env.CHAT_IN_FLIGHT_PER_CLIENT, DEFAULTS.inFlightPerClient, 100),
    inFlightGlobal: integer(env.CHAT_IN_FLIGHT_GLOBAL, DEFAULTS.inFlightGlobal, 1000),
  }
}
const LEASE_MS = 120000
function identity(value: string) { return createHash('sha256').update(clientKey(value)).digest('hex').slice(0, 24) }
function windows(client: string, now: number, config: ChatLimitConfig) {
  return [
    { key: `minute:${client}:${Math.floor(now / 60000)}`, limit: config.perMinute, end: (Math.floor(now / 60000) + 1) * 60000 },
    { key: `hour:${client}:${Math.floor(now / 3600000)}`, limit: config.perHour, end: (Math.floor(now / 3600000) + 1) * 3600000 },
    { key: `day:${Math.floor(now / 86400000)}`, limit: config.perDayGlobal, end: (Math.floor(now / 86400000) + 1) * 86400000 },
  ]
}
export class MemoryChatLimiter implements ChatLimiter {
  private counts = new Map<string, { value: number; end: number }>()
  private leases = new Map<string, { client: string; end: number }>()
  constructor(readonly config: ChatLimitConfig = DEFAULTS, readonly now: () => number = Date.now) {}
  async acquire(client: string): Promise<ChatReservation> {
    const now = this.now()
    const hash = identity(client)
    for (const [id, lease] of this.leases) if (lease.end <= now) this.leases.delete(id)
    for (const [key, count] of this.counts) if (count.end <= now) this.counts.delete(key)
    const rules = windows(hash, now, this.config)
    for (const rule of rules) {
      if ((this.counts.get(rule.key)?.value ?? 0) >= rule.limit) throw new ChatLimitError(429, 'chat_budget', rule.key.startsWith('day:') ? 'Today’s assistant capacity has been reached. Templates and canvas editing are still available.' : 'You’ve sent several assistant requests. Please wait before trying again.', Math.ceil((rule.end - now) / 1000))
    }
    if (this.leases.size >= this.config.inFlightGlobal || Array.from(this.leases.values()).filter(lease => lease.client === hash).length >= this.config.inFlightPerClient) throw new ChatLimitError(429, 'chat_busy', 'The assistant is already working on other requests. Please wait a moment.', 10)
    for (const rule of rules) this.counts.set(rule.key, { value: (this.counts.get(rule.key)?.value ?? 0) + 1, end: rule.end })
    const id = randomUUID()
    this.leases.set(id, { client: hash, end: now + LEASE_MS })
    return { release: async () => { this.leases.delete(id) } }
  }
}

export const CHAT_ACQUIRE_SCRIPT = `
for i = 4, 5 do redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', ARGV[7]) end
for i = 1, 3 do
  if tonumber(redis.call('GET', KEYS[i]) or '0') >= tonumber(ARGV[i * 2 - 1]) then
    return {0, math.ceil((tonumber(ARGV[i * 2]) - tonumber(ARGV[7])) / 1000), i}
  end
end
if redis.call('ZCARD', KEYS[4]) >= tonumber(ARGV[10]) or redis.call('ZCARD', KEYS[5]) >= tonumber(ARGV[11]) then return {2, 10} end
for i = 1, 3 do redis.call('INCR', KEYS[i]); redis.call('PEXPIREAT', KEYS[i], ARGV[i * 2]) end
for i = 4, 5 do redis.call('ZADD', KEYS[i], ARGV[8], ARGV[9]); redis.call('PEXPIRE', KEYS[i], 130000) end
return {1}
`
export const CHAT_RELEASE_SCRIPT = `for i = 1, #KEYS do redis.call('ZREM', KEYS[i], ARGV[1]) end; return 1`
interface RedisEval { eval(script: string, keys: string[], args: string[]): Promise<unknown> }
export class RedisChatLimiter implements ChatLimiter {
  constructor(private readonly redis: RedisEval, readonly config: ChatLimitConfig = DEFAULTS, readonly now: () => number = Date.now) {}
  async acquire(client: string): Promise<ChatReservation> {
    const now = this.now(), hash = identity(client), id = randomUUID()
    const rules = windows(hash, now, this.config)
    const leases = [`flowchart:chat:flight:${hash}`, 'flowchart:chat:flight:global']
    const keys = [...rules.map(rule => `flowchart:chat:${rule.key}`), ...leases]
    const args = [...rules.flatMap(rule => [String(rule.limit), String(rule.end)]), String(now), String(now + LEASE_MS), id, String(this.config.inFlightPerClient), String(this.config.inFlightGlobal)]
    let result: number[]
    try {
      const raw = await this.redis.eval(CHAT_ACQUIRE_SCRIPT, keys, args)
      if (!Array.isArray(raw)) throw new Error('Invalid counter reply')
      result = raw.map(Number)
    } catch { throw new ChatLimitError(503, 'chat_capacity_unavailable', 'Assistant capacity could not be checked. Please try again later.') }
    if (result[0] === 0) throw new ChatLimitError(429, 'chat_budget', result[2] === 3 ? 'Today’s assistant capacity has been reached. Templates and canvas editing are still available.' : 'You’ve sent several assistant requests. Please wait before trying again.', Math.max(1, result[1]))
    if (result[0] === 2) throw new ChatLimitError(429, 'chat_busy', 'The assistant is already working on other requests. Please wait a moment.', 10)
    if (result[0] !== 1) throw new ChatLimitError(503, 'chat_capacity_unavailable', 'Assistant capacity could not be checked. Please try again later.')
    let released = false
    return { release: async () => {
      if (released) return
      released = true
      try { await this.redis.eval(CHAT_RELEASE_SCRIPT, leases, [id]) } catch { /* Lease expires in 120 seconds; never fail open. */ }
    } }
  }
}
export function createChatLimiter(env: Record<string, string | undefined>): ChatLimiter {
  const config = chatLimitConfigFromEnv(env)
  const redis = resolveRedisConfig(env)
  if (redis) return new RedisChatLimiter(redisClient(redis), config)
  if (isProductionEnv(env)) throw new ChatLimitError(503, 'chat_capacity_unavailable', 'Shared assistant capacity is not configured on this server yet.')
  return new MemoryChatLimiter(config)
}
