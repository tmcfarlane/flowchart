// Rate limits and budgets for the anonymous API (no accounts, no API keys).
//
// - Per-IP limits stop one script from hogging the service. Hosted agents
//   (Claude, ChatGPT) reach remote MCP servers from their provider's shared
//   egress IPs, so the MCP tool limits per IP are much higher than the
//   browser's REST limits.
// - Global budgets cap what all clients together can spend per window (chart
//   creations, chart updates, storage growth), so a free deployment can't be
//   driven into runaway bills or exhausted free-tier quotas.
// - Creations and updates are charged in work units: one unit per request plus
//   extra units for large server-side layouts (see layoutWorkUnits).
//
// Counters are fixed windows. "Shared" buckets are counted in Redis so they
// hold across function instances; the cheap, high-volume buckets (reads,
// polls, MCP requests) are counted in memory per instance so they cost no
// Redis commands. Limits fail open: if Redis is unreachable, requests pass.

import { createHash } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'

export type RateBucket =
  | 'create' // POST /api/flows (REST, usually the browser)
  | 'write' // PUT/PATCH /api/flows/:id (REST, usually the browser)
  | 'mcpCreate' // create_flowchart
  | 'mcpWrite' // update_flowchart
  | 'read' // GET /api/flows/:id and get_flowchart
  | 'poll' // GET /api/flows/:id?since=<version>
  | 'mcp' // every POST /api/mcp (cost = JSON-RPC messages in the body)
  | 'storage' // bytes by which stored charts grow (global budget only)

export type PerIpBucket = Exclude<RateBucket, 'storage'>
export type GlobalBudget = 'creates' | 'writes' | 'storage'

export interface RateRule {
  limit: number
  windowSeconds: number
}

export interface RateLimitConfig {
  /** null disables that limit. */
  perIp: Record<PerIpBucket, RateRule | null>
  global: Record<GlobalBudget, RateRule | null>
}

export interface RateLimitConfigInput {
  perIp?: Partial<Record<PerIpBucket, RateRule | null>>
  global?: Partial<Record<GlobalBudget, RateRule | null>>
}

const MINUTE = 60
const HOUR = 3600
const DAY = 86_400
const MB = 1024 * 1024

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  perIp: {
    create: { limit: 30, windowSeconds: 10 * MINUTE },
    write: { limit: 120, windowSeconds: MINUTE },
    mcpCreate: { limit: 300, windowSeconds: HOUR },
    mcpWrite: { limit: 1200, windowSeconds: HOUR },
    read: { limit: 600, windowSeconds: MINUTE },
    poll: { limit: 1200, windowSeconds: MINUTE },
    mcp: { limit: 1200, windowSeconds: MINUTE },
  },
  global: {
    creates: { limit: 5000, windowSeconds: DAY },
    writes: { limit: 50_000, windowSeconds: DAY },
    storage: { limit: 50 * MB, windowSeconds: DAY },
  },
}

/** Buckets counted per function instance, in memory (no Redis commands). */
export const LOCAL_BUCKETS: ReadonlySet<RateBucket> = new Set<RateBucket>(['read', 'poll', 'mcp'])

const BUDGET_OF: Partial<Record<RateBucket, GlobalBudget>> = {
  create: 'creates',
  mcpCreate: 'creates',
  write: 'writes',
  mcpWrite: 'writes',
  storage: 'storage',
}

export interface RateLimitResult {
  allowed: boolean
  /** "ip": this client's limit. "global": the budget shared by everyone. */
  scope: 'ip' | 'global'
  limit: number
  remaining: number
  windowSeconds: number
  retryAfterSeconds: number
}

export interface RateLimiter {
  readonly kind: 'upstash' | 'memory' | 'off'
  /** Charge `cost` units (default 1) to `bucket` for the client at `ip`. */
  check(bucket: RateBucket, ip: string, cost?: number): Promise<RateLimitResult>
}

const UNLIMITED: RateLimitResult = {
  allowed: true,
  scope: 'ip',
  limit: Infinity,
  remaining: Infinity,
  windowSeconds: 0,
  retryAfterSeconds: 0,
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const PER_IP_ENV: Record<PerIpBucket, string> = {
  create: 'FLOW_LIMIT_CREATE',
  write: 'FLOW_LIMIT_WRITE',
  mcpCreate: 'FLOW_LIMIT_MCP_CREATE',
  mcpWrite: 'FLOW_LIMIT_MCP_WRITE',
  read: 'FLOW_LIMIT_READ',
  poll: 'FLOW_LIMIT_POLL',
  mcp: 'FLOW_LIMIT_MCP',
}

export const GLOBAL_ENV: Record<GlobalBudget, string> = {
  creates: 'FLOW_BUDGET_CREATES',
  writes: 'FLOW_BUDGET_WRITES',
  storage: 'FLOW_BUDGET_STORAGE',
}

const WINDOW_UNITS: Record<string, number> = { s: 1, m: MINUTE, h: HOUR, d: DAY }
const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: MB, gb: 1024 * MB }

/**
 * Parse "30/10m", "5000/1d", "600/min" or (for byte budgets) "50mb/1d".
 * Returns null for "off", and undefined when the value can't be parsed.
 */
export function parseRateRule(value: string, { bytes = false } = {}): RateRule | null | undefined {
  const text = value.trim().toLowerCase()
  if (['off', 'none', 'unlimited', '0'].includes(text)) return null
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?\s*\/\s*(\d+)?\s*(s|sec|m|min|h|hr|hour|d|day)$/)
  if (!match) return undefined
  const [, amount, sizeUnit, count, unit] = match
  if (sizeUnit && !bytes) return undefined
  const limit = Math.floor(Number(amount) * (bytes ? SIZE_UNITS[sizeUnit ?? 'b'] : 1))
  const windowSeconds = (count ? Number(count) : 1) * WINDOW_UNITS[unit[0]]
  if (!(limit > 0) || !(windowSeconds > 0)) return undefined
  return { limit, windowSeconds }
}

export function resolveRateLimitConfig(input: RateLimitConfigInput = {}): RateLimitConfig {
  return {
    perIp: { ...DEFAULT_RATE_LIMITS.perIp, ...input.perIp },
    global: { ...DEFAULT_RATE_LIMITS.global, ...input.global },
  }
}

export function rateLimitConfigFromEnv(
  env: Record<string, string | undefined>,
  warn: (message: string) => void = console.warn,
): RateLimitConfig {
  const config = resolveRateLimitConfig()
  const read = (name: string, bytes: boolean): RateRule | null | undefined => {
    const raw = env[name]?.trim()
    if (!raw) return undefined
    const rule = parseRateRule(raw, { bytes })
    if (rule === undefined) {
      warn(`[flowchart] Ignoring ${name}=${JSON.stringify(raw)}: use "<count>/<window>" such as "300/1h", or "off".`)
    }
    return rule
  }
  for (const bucket of Object.keys(PER_IP_ENV) as PerIpBucket[]) {
    const rule = read(PER_IP_ENV[bucket], false)
    if (rule !== undefined) config.perIp[bucket] = rule
  }
  for (const budget of Object.keys(GLOBAL_ENV) as GlobalBudget[]) {
    const rule = read(GLOBAL_ENV[budget], budget === 'storage')
    if (rule !== undefined) config.global[budget] = rule
  }
  return config
}

// ---------------------------------------------------------------------------
// Client keys
// ---------------------------------------------------------------------------

function ipv4ToGroups(ip: string): string[] {
  const [a, b, c, d] = ip.split('.').map(Number)
  return [((a << 8) | b).toString(16), ((c << 8) | d).toString(16)]
}

/** The first four groups (the /64 network) of an IPv6 address. */
function ipv6Network(ip: string): string {
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, undefined]
  const expand = (part: string | undefined) =>
    part ? part.split(':').flatMap((g) => (g.includes('.') ? ipv4ToGroups(g) : [g])) : []
  const left = expand(head)
  const right = expand(tail)
  const groups = [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
  return groups
    .slice(0, 4)
    .map((g) => parseInt(g || '0', 16).toString(16))
    .join(':')
}

/**
 * Key for per-client limits: the IPv4 address, or the /64 network of an IPv6
 * address (one subscriber usually controls a whole /64). Anything else is hashed.
 */
export function clientKey(ip: string): string {
  let value = ip.trim().toLowerCase().split('%')[0]
  if (value.startsWith('::ffff:') && isIPv4(value.slice(7))) value = value.slice(7)
  if (isIPv4(value)) return value
  if (isIPv6(value)) return `${ipv6Network(value)}::/64`
  return `h-${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

interface Counter {
  scope: 'ip' | 'global'
  key: string
  rule: RateRule
  amount: number
  windowIndex: number
  resetAtMs: number
}

function countersFor(config: RateLimitConfig, bucket: RateBucket, ip: string, cost: number, nowMs: number): Counter[] {
  const counters: Counter[] = []
  const add = (scope: Counter['scope'], name: string, rule: RateRule | null) => {
    if (!rule) return
    const windowMs = rule.windowSeconds * 1000
    const windowIndex = Math.floor(nowMs / windowMs)
    counters.push({
      scope,
      key: `${name}:${windowIndex}`,
      rule,
      // A single expensive request is allowed in a fresh window.
      amount: Math.max(1, Math.min(Math.ceil(cost), rule.limit)),
      windowIndex,
      resetAtMs: (windowIndex + 1) * windowMs,
    })
  }
  if (bucket !== 'storage') add('ip', `flowchart:rl:${bucket}:${clientKey(ip)}`, config.perIp[bucket])
  const budget = BUDGET_OF[bucket]
  if (budget) add('global', `flowchart:budget:${budget}`, config.global[budget])
  return counters
}

function allowedResult(counters: Counter[], totals: number[]): RateLimitResult {
  const index = Math.max(0, counters.findIndex((c) => c.scope === 'ip'))
  const counter = counters[index]
  return {
    allowed: true,
    scope: counter.scope,
    limit: counter.rule.limit,
    remaining: Math.max(0, counter.rule.limit - totals[index]),
    windowSeconds: counter.rule.windowSeconds,
    retryAfterSeconds: 0,
  }
}

function blockedResult(counter: Counter, nowMs: number): RateLimitResult {
  return {
    allowed: false,
    scope: counter.scope,
    limit: counter.rule.limit,
    remaining: 0,
    windowSeconds: counter.rule.windowSeconds,
    retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAtMs - nowMs) / 1000)),
  }
}

/** Fixed-window counters kept in this process. */
class MemoryCounters {
  private windows = new Map<string, { resetAtMs: number; total: number }>()
  private operations = 0

  /** Adds every counter's amount if all stay within their limits; otherwise adds nothing. */
  consume(counters: Counter[], nowMs: number): { ok: true; totals: number[] } | { ok: false; failed: Counter } {
    if (++this.operations % 1000 === 0) this.sweep(nowMs)
    const current = counters.map((c) => {
      const entry = this.windows.get(c.key)
      return entry && entry.resetAtMs > nowMs ? entry.total : 0
    })
    const failed = counters.find((c, i) => current[i] + c.amount > c.rule.limit)
    if (failed) return { ok: false, failed }
    const totals = counters.map((c, i) => {
      const total = current[i] + c.amount
      this.windows.set(c.key, { resetAtMs: c.resetAtMs, total })
      return total
    })
    return { ok: true, totals }
  }

  private sweep(nowMs: number) {
    for (const [key, entry] of this.windows) if (entry.resetAtMs <= nowMs) this.windows.delete(key)
  }
}

/**
 * Charges each counter (ARGV holds amount, limit and expiry per key) and
 * rolls everything back if one would go over its limit. Replies {1, totals...}
 * or {0, index of the full counter, its total before this request}.
 */
export const CONSUME_SCRIPT = `
local reply = {1}
for i = 1, #KEYS do
  local amount = tonumber(ARGV[i * 3 - 2])
  local total = redis.call('INCRBY', KEYS[i], amount)
  if total == amount then redis.call('PEXPIREAT', KEYS[i], ARGV[i * 3]) end
  if total > tonumber(ARGV[i * 3 - 1]) then
    for j = 1, i do redis.call('DECRBY', KEYS[j], tonumber(ARGV[j * 3 - 2])) end
    return {0, i, total - amount}
  end
  reply[i + 1] = total
end
return reply
`

/** Minimal slice of the @upstash/redis client used here (lets tests substitute a fake). */
export interface RedisEval {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>
}

abstract class BaseRateLimiter implements RateLimiter {
  abstract readonly kind: 'upstash' | 'memory'
  readonly config: RateLimitConfig
  protected local = new MemoryCounters()

  constructor(config: RateLimitConfigInput | RateLimitConfig = {}, protected readonly now: () => number = Date.now) {
    this.config = resolveRateLimitConfig(config)
  }

  async check(bucket: RateBucket, ip: string, cost = 1): Promise<RateLimitResult> {
    const nowMs = this.now()
    const counters = countersFor(this.config, bucket, ip, cost, nowMs)
    if (counters.length === 0) return UNLIMITED
    if (LOCAL_BUCKETS.has(bucket)) return this.consumeLocally(counters, nowMs)
    return this.consumeShared(counters, nowMs)
  }

  protected consumeLocally(counters: Counter[], nowMs: number): RateLimitResult {
    const result = this.local.consume(counters, nowMs)
    return result.ok ? allowedResult(counters, result.totals) : blockedResult(result.failed, nowMs)
  }

  protected abstract consumeShared(counters: Counter[], nowMs: number): Promise<RateLimitResult>
}

/** Everything in memory: local development, tests, and single-process self-hosting. */
export class MemoryRateLimiter extends BaseRateLimiter {
  readonly kind = 'memory' as const

  protected async consumeShared(counters: Counter[], nowMs: number): Promise<RateLimitResult> {
    return this.consumeLocally(counters, nowMs)
  }
}

/** Shared buckets and budgets in Redis (one EVAL per check); reads, polls and MCP requests in memory. */
export class UpstashRateLimiter extends BaseRateLimiter {
  readonly kind = 'upstash' as const
  /** Counters known to be full until their window ends, so floods don't cost Redis commands. */
  private full = new Map<string, number>()
  private lastErrorLog = 0

  constructor(
    private readonly redis: RedisEval,
    config: RateLimitConfigInput | RateLimitConfig = {},
    now: () => number = Date.now,
    private readonly log: Pick<Console, 'error'> = console,
  ) {
    super(config, now)
  }

  protected async consumeShared(counters: Counter[], nowMs: number): Promise<RateLimitResult> {
    for (const counter of counters) {
      const fullUntil = this.full.get(counter.key)
      if (fullUntil !== undefined && fullUntil > nowMs) return blockedResult(counter, nowMs)
    }
    if (this.full.size > 10_000) this.full.clear()

    let reply: unknown
    try {
      reply = await this.redis.eval(
        CONSUME_SCRIPT,
        counters.map((c) => c.key),
        counters.flatMap((c) => [String(c.amount), String(c.rule.limit), String(c.resetAtMs + 60_000)]),
      )
    } catch (err) {
      // Fail open: a limiter outage should not take the API down with it.
      if (nowMs - this.lastErrorLog > 60_000) {
        this.lastErrorLog = nowMs
        this.log.error('[flowchart] Rate limiter unavailable; allowing requests.', err)
      }
      return { ...UNLIMITED, retryAfterSeconds: 0 }
    }

    const [status, ...rest] = (Array.isArray(reply) ? reply : [reply]).map(Number)
    if (status === 1) return allowedResult(counters, counters.map((c, i) => rest[i] ?? c.amount))
    const failed = counters[Math.min(counters.length, Math.max(1, rest[0] || 1)) - 1]
    // Remember counters that are full so repeated requests skip Redis until the window ends.
    if (rest[1] >= failed.rule.limit) this.full.set(failed.key, failed.resetAtMs)
    return blockedResult(failed, nowMs)
  }
}

export class NoopRateLimiter implements RateLimiter {
  readonly kind = 'off' as const
  async check(): Promise<RateLimitResult> {
    return UNLIMITED
  }
}

export function createRateLimiterFromEnv(
  env: Record<string, string | undefined>,
  redis: RedisEval | null,
): RateLimiter {
  if (env.FLOW_RATE_LIMIT === 'off') return new NoopRateLimiter()
  const config = rateLimitConfigFromEnv(env)
  return redis ? new UpstashRateLimiter(redis, config) : new MemoryRateLimiter(config)
}

// ---------------------------------------------------------------------------
// Messages and quotas
// ---------------------------------------------------------------------------

const WHAT: Record<RateBucket, string> = {
  create: 'new charts',
  mcpCreate: 'new charts',
  write: 'chart updates',
  mcpWrite: 'chart updates',
  read: 'chart reads',
  poll: 'update checks',
  mcp: 'MCP requests',
  storage: 'new chart data',
}

export function formatWindow(seconds: number): string {
  if (seconds === DAY) return 'per day'
  if (seconds === HOUR) return 'per hour'
  if (seconds === MINUTE) return 'per minute'
  if (seconds % DAY === 0) return `per ${seconds / DAY} days`
  if (seconds % HOUR === 0) return `per ${seconds / HOUR} hours`
  if (seconds % MINUTE === 0) return `per ${seconds / MINUTE} minutes`
  return `per ${seconds} seconds`
}

export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 90) return `${minutes} minutes`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `${hours} hour${hours === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`
}

function formatAmount(bucket: RateBucket, limit: number): string {
  if (bucket !== 'storage') return String(limit)
  return limit >= MB ? `${Math.round((limit / MB) * 10) / 10} MB` : `${Math.round(limit / 1024)} KB`
}

/** A human (and agent) readable explanation of a blocked request. */
export function rateLimitMessage(bucket: RateBucket, result: RateLimitResult): string {
  const what = WHAT[bucket]
  const retry = `Try again in ${formatDuration(result.retryAfterSeconds)}.`
  const weighted = bucket === 'create' || bucket === 'mcpCreate' || bucket === 'write' || bucket === 'mcpWrite'
  const note = weighted ? ' (a large automatic layout counts as several)' : ''
  if (result.scope === 'global') {
    return (
      `Flowchart AI has used its budget for ${what}: ${formatAmount(bucket, result.limit)} ${formatWindow(result.windowSeconds)} ` +
      `across all users${note}. The budget keeps the free service within its hosting limits. ${retry}`
    )
  }
  return `Rate limit reached for ${what} from your network: ${result.limit} ${formatWindow(result.windowSeconds)}${note}. ${retry}`
}

export type QuotaDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number; message: string }

/** Charges made while a create or update runs (see FlowService). */
export interface WriteQuota {
  /** Extra work units for an expensive layout; one unit was charged when the request arrived. */
  work?(units: number): Promise<QuotaDecision>
  /** Bytes by which stored charts grow. */
  growth?(bytes: number): Promise<QuotaDecision>
}

export type ClientRateLimit = (bucket: RateBucket, cost?: number) => Promise<RateLimitResult>

function decide(bucket: RateBucket, result: RateLimitResult): QuotaDecision {
  return result.allowed
    ? { allowed: true }
    : { allowed: false, retryAfterSeconds: result.retryAfterSeconds, message: rateLimitMessage(bucket, result) }
}

/** The quota for one client's create or update, charged to `bucket` and the storage budget. */
export function writeQuota(check: ClientRateLimit, bucket: RateBucket): WriteQuota {
  return {
    work: async (units) => decide(bucket, await check(bucket, units)),
    growth: async (bytes) => decide('storage', await check('storage', bytes)),
  }
}
