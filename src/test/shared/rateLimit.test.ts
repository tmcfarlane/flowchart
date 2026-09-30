// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import {
  CONSUME_SCRIPT,
  DEFAULT_RATE_LIMITS,
  MemoryRateLimiter,
  NoopRateLimiter,
  UpstashRateLimiter,
  clientKey,
  createRateLimiterFromEnv,
  formatDuration,
  parseRateRule,
  rateLimitConfigFromEnv,
  rateLimitMessage,
  writeQuota,
  type RateLimitConfigInput,
  type RedisEval,
} from '../../shared/server/rateLimit'

const MINUTE = 60_000
// A time at the start of a UTC day, so fixed windows line up predictably.
const DAY_START = Date.UTC(2026, 0, 1)

const small: RateLimitConfigInput = {
  perIp: {
    create: { limit: 2, windowSeconds: 60 },
    write: { limit: 3, windowSeconds: 60 },
    mcpCreate: { limit: 5, windowSeconds: 3600 },
    read: { limit: 100, windowSeconds: 60 },
  },
  global: {
    creates: { limit: 4, windowSeconds: 86_400 },
    writes: null,
    storage: { limit: 1000, windowSeconds: 86_400 },
  },
}

/** Emulates CONSUME_SCRIPT with Redis semantics (INCRBY, rollback, expiry). */
class FakeRedis implements RedisEval {
  values = new Map<string, number>()
  expiresAt = new Map<string, number>()
  calls = 0
  failing = false

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    this.calls++
    if (this.failing) throw new Error('fetch failed')
    expect(script).toBe(CONSUME_SCRIPT)
    const reply = [1]
    for (let i = 0; i < keys.length; i++) {
      const amount = Number(args[i * 3])
      const limit = Number(args[i * 3 + 1])
      const total = (this.values.get(keys[i]) ?? 0) + amount
      this.values.set(keys[i], total)
      if (total === amount) this.expiresAt.set(keys[i], Number(args[i * 3 + 2]))
      if (total > limit) {
        for (let j = 0; j <= i; j++) this.values.set(keys[j], this.values.get(keys[j])! - Number(args[j * 3]))
        return [0, i + 1, total - amount]
      }
      reply.push(total)
    }
    return reply
  }
}

describe('parseRateRule', () => {
  it('reads counts, windows and byte sizes', () => {
    expect(parseRateRule('30/10m')).toEqual({ limit: 30, windowSeconds: 600 })
    expect(parseRateRule('5000/1d')).toEqual({ limit: 5000, windowSeconds: 86_400 })
    expect(parseRateRule('600/min')).toEqual({ limit: 600, windowSeconds: 60 })
    expect(parseRateRule(' 20 / 1h ')).toEqual({ limit: 20, windowSeconds: 3600 })
    expect(parseRateRule('50mb/1d', { bytes: true })).toEqual({ limit: 50 * 1024 * 1024, windowSeconds: 86_400 })
    expect(parseRateRule('off')).toBeNull()
    expect(parseRateRule('0')).toBeNull()
    for (const bad of ['30', '30/10x', 'abc/1m', '-5/1m', '50mb/1d']) expect(parseRateRule(bad)).toBeUndefined()
  })

  it('builds the configuration from environment variables and ignores bad values', () => {
    const warn = vi.fn()
    const config = rateLimitConfigFromEnv(
      { FLOW_LIMIT_MCP_CREATE: '1000/1h', FLOW_LIMIT_POLL: 'off', FLOW_BUDGET_STORAGE: '10mb/1d', FLOW_BUDGET_WRITES: 'lots' },
      warn,
    )
    expect(config.perIp.mcpCreate).toEqual({ limit: 1000, windowSeconds: 3600 })
    expect(config.perIp.poll).toBeNull()
    expect(config.global.storage).toEqual({ limit: 10 * 1024 * 1024, windowSeconds: 86_400 })
    expect(config.global.writes).toEqual(DEFAULT_RATE_LIMITS.global.writes)
    expect(config.perIp.create).toEqual(DEFAULT_RATE_LIMITS.perIp.create)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FLOW_BUDGET_WRITES'))
  })

  it('gives agents (shared egress IPs) much more room than the browser', () => {
    const { perIp } = DEFAULT_RATE_LIMITS
    const perHour = (rule: { limit: number; windowSeconds: number } | null) => (rule!.limit * 3600) / rule!.windowSeconds
    expect(perHour(perIp.mcpCreate)).toBeGreaterThan(perHour(perIp.create))
    expect(DEFAULT_RATE_LIMITS.global.creates).not.toBeNull()
    expect(DEFAULT_RATE_LIMITS.global.writes).not.toBeNull()
    expect(DEFAULT_RATE_LIMITS.global.storage).not.toBeNull()
  })
})

describe('clientKey', () => {
  it('keys IPv4 by address and IPv6 by /64 network', () => {
    expect(clientKey('203.0.113.7')).toBe('203.0.113.7')
    expect(clientKey('::ffff:203.0.113.7')).toBe('203.0.113.7')
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64')
    expect(clientKey('2001:DB8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:db8:1:2::/64')
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('::1')).toBe('0:0:0:0::/64')
    expect(clientKey('unknown')).toMatch(/^h-[0-9a-f]{16}$/)
  })
})

describe('MemoryRateLimiter', () => {
  it('allows requests up to the limit, then says when the window resets', async () => {
    let now = DAY_START + 10_000
    const limiter = new MemoryRateLimiter(small, () => now)
    expect(await limiter.check('create', '1.1.1.1')).toMatchObject({ allowed: true, remaining: 1 })
    expect(await limiter.check('create', '1.1.1.1')).toMatchObject({ allowed: true, remaining: 0 })
    const blocked = await limiter.check('create', '1.1.1.1')
    expect(blocked).toMatchObject({ allowed: false, scope: 'ip', limit: 2, remaining: 0, windowSeconds: 60 })
    expect(blocked.retryAfterSeconds).toBe(50) // fixed one-minute windows

    now += 20_000
    expect((await limiter.check('create', '1.1.1.1')).retryAfterSeconds).toBe(30)
    now += 30_000
    expect((await limiter.check('create', '1.1.1.1')).allowed).toBe(true)
  })

  it('tracks buckets and clients separately', async () => {
    const now = DAY_START
    const limiter = new MemoryRateLimiter(small, () => now)
    await limiter.check('write', 'a')
    await limiter.check('write', 'a')
    await limiter.check('write', 'a')
    expect((await limiter.check('write', 'a')).allowed).toBe(false)
    expect((await limiter.check('write', 'b')).allowed).toBe(true)
    expect((await limiter.check('create', 'a')).allowed).toBe(true)
  })

  it('shares the global budget across clients and says so', async () => {
    let now = DAY_START + 6 * 3600_000
    const limiter = new MemoryRateLimiter(small, () => now)
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4']) {
      expect((await limiter.check('mcpCreate', ip)).allowed).toBe(true)
    }
    const blocked = await limiter.check('create', '5.5.5.5') // REST and MCP creations share it
    expect(blocked).toMatchObject({ allowed: false, scope: 'global', limit: 4 })
    expect(blocked.retryAfterSeconds).toBe(18 * 3600) // until the next UTC day
    expect(rateLimitMessage('create', blocked)).toMatch(/budget for new charts: 4 per day across all users.*Try again in 18 hours/)

    // A refused request doesn't use up the client's own allowance.
    now += 18 * 3600_000
    expect((await limiter.check('create', '5.5.5.5')).allowed).toBe(true)
    expect((await limiter.check('create', '5.5.5.5')).allowed).toBe(true)
  })

  it('charges costs, letting one expensive request through in a fresh window', async () => {
    const now = DAY_START
    const limiter = new MemoryRateLimiter(small, () => now)
    expect((await limiter.check('mcpCreate', 'a', 50)).allowed).toBe(true) // capped at the limit (5)
    expect((await limiter.check('mcpCreate', 'a')).allowed).toBe(false)
    expect((await limiter.check('storage', 'a', 600)).allowed).toBe(true)
    expect(await limiter.check('storage', 'b', 600)).toMatchObject({ allowed: false, scope: 'global' })
    expect((await limiter.check('storage', 'b', 400)).allowed).toBe(true)
  })

  it('treats a disabled limit as unlimited', async () => {
    const limiter = new MemoryRateLimiter({ perIp: { poll: null } })
    for (let i = 0; i < 2000; i++) expect((await limiter.check('poll', 'a')).allowed).toBe(true)
  })
})

describe('UpstashRateLimiter', () => {
  it('uses one script call for the client limit and the global budget', async () => {
    const redis = new FakeRedis()
    const limiter = new UpstashRateLimiter(redis, small, () => DAY_START + 1000)
    expect(await limiter.check('mcpCreate', '1.1.1.1')).toMatchObject({ allowed: true, remaining: 4 })
    expect(redis.calls).toBe(1)
    const keys = [...redis.values.keys()]
    expect(keys).toEqual([
      `flowchart:rl:mcpCreate:1.1.1.1:${Math.floor((DAY_START + 1000) / 3600_000)}`,
      `flowchart:budget:creates:${Math.floor((DAY_START + 1000) / 86_400_000)}`,
    ])
    // Keys expire shortly after their window ends.
    expect(redis.expiresAt.get(keys[1])).toBe(DAY_START + 86_400_000 + 60_000)
  })

  it('keeps reads, polls and MCP requests out of Redis', async () => {
    const redis = new FakeRedis()
    const limiter = new UpstashRateLimiter(redis, small)
    await limiter.check('read', '1.1.1.1')
    await limiter.check('poll', '1.1.1.1')
    await limiter.check('mcp', '1.1.1.1')
    expect(redis.calls).toBe(0)
  })

  it('rolls back when a budget is full and skips Redis while a counter stays full', async () => {
    const redis = new FakeRedis()
    const limiter = new UpstashRateLimiter(redis, small, () => DAY_START)
    for (const ip of ['a', 'b', 'c', 'd']) expect((await limiter.check('create', ip)).allowed).toBe(true)
    const blocked = await limiter.check('create', 'e')
    expect(blocked).toMatchObject({ allowed: false, scope: 'global' })
    expect([...redis.values.values()].reduce((a, b) => a + b, 0)).toBe(8) // e's own counter was rolled back
    const calls = redis.calls
    expect((await limiter.check('create', 'f')).allowed).toBe(false)
    expect(redis.calls).toBe(calls)
  })

  it('fails open (and logs once) when Redis is unreachable', async () => {
    const redis = new FakeRedis()
    redis.failing = true
    const log = { error: vi.fn() }
    const limiter = new UpstashRateLimiter(redis, small, Date.now, log)
    expect((await limiter.check('create', 'a')).allowed).toBe(true)
    expect((await limiter.check('write', 'a')).allowed).toBe(true)
    expect(log.error).toHaveBeenCalledTimes(1)
  })
})

describe('createRateLimiterFromEnv', () => {
  it('picks the implementation from the environment', () => {
    expect(createRateLimiterFromEnv({}, null).kind).toBe('memory')
    expect(createRateLimiterFromEnv({ FLOW_RATE_LIMIT: 'off' }, null)).toBeInstanceOf(NoopRateLimiter)
    expect(createRateLimiterFromEnv({}, new FakeRedis()).kind).toBe('upstash')
  })
})

describe('messages and quotas', () => {
  it('explains client limits and formats waits', () => {
    const message = rateLimitMessage('mcpWrite', {
      allowed: false,
      scope: 'ip',
      limit: 1200,
      remaining: 0,
      windowSeconds: 3600,
      retryAfterSeconds: 125,
    })
    expect(message).toBe(
      'Rate limit reached for chart updates from your network: 1200 per hour (a large automatic layout counts as several). Try again in 3 minutes.',
    )
    expect(formatDuration(1)).toBe('1 second')
    expect(formatDuration(89)).toBe('89 seconds')
    expect(formatDuration(3 * 3600 + 60)).toBe('3 hours 1 minute')
  })

  it('charges work to the request bucket and growth to the storage budget', async () => {
    const check = vi.fn(async (bucket: string) =>
      bucket === 'storage'
        ? { allowed: false, scope: 'global' as const, limit: 1024 * 1024, remaining: 0, windowSeconds: 86_400, retryAfterSeconds: 60 }
        : { allowed: true, scope: 'ip' as const, limit: 10, remaining: 5, windowSeconds: 60, retryAfterSeconds: 0 },
    )
    const quota = writeQuota(check, 'mcpCreate')
    expect(await quota.work!(7)).toEqual({ allowed: true })
    expect(check).toHaveBeenCalledWith('mcpCreate', 7)
    const growth = await quota.growth!(5000)
    expect(growth).toMatchObject({ allowed: false, retryAfterSeconds: 60 })
    expect(check).toHaveBeenCalledWith('storage', 5000)
    expect(growth.allowed === false && growth.message).toContain('budget for new chart data: 1 MB per day')
  })
})
