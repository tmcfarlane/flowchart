import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AiConfig, AiEnv } from './aiConfig.js'
import { redisClient, resolveRedisConfig } from './store.js'
import { clientKey } from './rateLimit.js'

export type AdmissionReason = 'client_rate' | 'global_rate' | 'budget' | 'concurrency'
export type AdmissionResult =
  | { allowed: true; release(): Promise<void> }
  | { allowed: false; reason: AdmissionReason; retryAfterSeconds: number }
export interface AiAdmission {
  acquire(input: { id: string; client: string; costMicros: number; leaseMs: number }): Promise<AdmissionResult>
}
export interface AiRedis {
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>
}
export class AiAdmissionUnavailable extends Error {}

type Policy = Pick<AiConfig, 'environment' | 'clientPerMinute' | 'globalPerMinute' | 'dailyBudgetMicros' | 'concurrency'>
const DAY = 86400000
const MINUTE = 60000

export const AI_ACQUIRE_SCRIPT = `
local now = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local lease = tonumber(ARGV[3])
local id = ARGV[4]
local clientLimit = tonumber(ARGV[5])
local globalLimit = tonumber(ARGV[6])
local budget = tonumber(ARGV[7])
local concurrentLimit = tonumber(ARGV[8])
local minuteExpiry = tonumber(ARGV[9])
local dayExpiry = tonumber(ARGV[10])
redis.call('ZREMRANGEBYSCORE', KEYS[4], '-inf', now)
if tonumber(redis.call('GET', KEYS[1]) or '0') >= clientLimit then return {0, 1, minuteExpiry - now} end
if tonumber(redis.call('GET', KEYS[2]) or '0') >= globalLimit then return {0, 2, minuteExpiry - now} end
if tonumber(redis.call('GET', KEYS[3]) or '0') + cost > budget then return {0, 3, dayExpiry - now} end
if redis.call('ZCARD', KEYS[4]) >= concurrentLimit then
  local oldest = redis.call('ZRANGE', KEYS[4], 0, 0, 'WITHSCORES')
  return {0, 4, math.max(1000, tonumber(oldest[2]) - now)}
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIREAT', KEYS[1], minuteExpiry + 60000)
redis.call('INCR', KEYS[2])
redis.call('PEXPIREAT', KEYS[2], minuteExpiry + 60000)
redis.call('INCRBY', KEYS[3], cost)
redis.call('PEXPIREAT', KEYS[3], dayExpiry + 60000)
redis.call('ZADD', KEYS[4], now + lease, id)
redis.call('PEXPIRE', KEYS[4], lease + 60000)
return {1, 0, 0}
`
const RELEASE_SCRIPT = `return redis.call('ZREM', KEYS[1], ARGV[1])`
const resultSchema = z.tuple([z.number().int().min(0).max(1), z.number().int().min(0).max(4), z.number().finite().nonnegative()])
const reasons = ['client_rate', 'global_rate', 'budget', 'concurrency'] as const

function keysFor(policy: Policy, client: string, now: number): string[] {
  const hash = createHash('sha256').update(clientKey(client)).digest('hex')
  const prefix = `flowchart:ai:{${policy.environment}}`
  return [
    `${prefix}:client:${hash}:${Math.floor(now / MINUTE)}`,
    `${prefix}:global:${Math.floor(now / MINUTE)}`,
    `${prefix}:budget:${Math.floor(now / DAY)}`,
    `${prefix}:leases`,
  ]
}

export class RedisAiAdmission implements AiAdmission {
  constructor(private redis: AiRedis, private policy: Policy, private now: () => number = Date.now) {}

  async acquire(input: { id: string; client: string; costMicros: number; leaseMs: number }): Promise<AdmissionResult> {
    const now = this.now()
    const keys = keysFor(this.policy, input.client, now)
    try {
      const result = resultSchema.parse(await this.redis.eval(AI_ACQUIRE_SCRIPT, keys, [
        now, input.costMicros, input.leaseMs, input.id,
        this.policy.clientPerMinute, this.policy.globalPerMinute, this.policy.dailyBudgetMicros, this.policy.concurrency,
        (Math.floor(now / MINUTE) + 1) * MINUTE, (Math.floor(now / DAY) + 1) * DAY,
      ]))
      if (result[0] === 1 && result[1] === 0 && result[2] === 0) {
        return { allowed: true, release: async () => {
          try {
            await this.redis.eval(RELEASE_SCRIPT, [keys[3]], [input.id])
          } catch {
            // An unreleased lease expires; spending allowance is never refunded.
          }
        } }
      }
      const reason = reasons[result[1] - 1]
      if (result[0] !== 0 || !reason || result[2] <= 0) throw new AiAdmissionUnavailable()
      return { allowed: false, reason, retryAfterSeconds: Math.max(1, Math.ceil(result[2] / 1000)) }
    } catch {
      throw new AiAdmissionUnavailable('AI protection is temporarily unavailable')
    }
  }
}

interface Counter { value: number; expiresAt: number }
export class MemoryAiAdmission implements AiAdmission {
  private counters = new Map<string, Counter>()
  private leases = new Map<string, number>()
  constructor(private policy: Policy, private now: () => number = Date.now) {}

  async acquire(input: { id: string; client: string; costMicros: number; leaseMs: number }): Promise<AdmissionResult> {
    const now = this.now()
    for (const [key, counter] of this.counters) if (counter.expiresAt <= now) this.counters.delete(key)
    for (const [id, expiry] of this.leases) if (expiry <= now) this.leases.delete(id)
    const keys = keysFor(this.policy, input.client, now)
    const minuteExpiry = (Math.floor(now / MINUTE) + 1) * MINUTE
    const dayExpiry = (Math.floor(now / DAY) + 1) * DAY
    const rules = [
      { key: keys[0], amount: 1, limit: this.policy.clientPerMinute, expiry: minuteExpiry, reason: 'client_rate' },
      { key: keys[1], amount: 1, limit: this.policy.globalPerMinute, expiry: minuteExpiry, reason: 'global_rate' },
      { key: keys[2], amount: input.costMicros, limit: this.policy.dailyBudgetMicros, expiry: dayExpiry, reason: 'budget' },
    ] satisfies Array<{ key: string; amount: number; limit: number; expiry: number; reason: AdmissionReason }>
    for (const rule of rules) {
      if ((this.counters.get(rule.key)?.value || 0) + rule.amount > rule.limit) {
        return { allowed: false, reason: rule.reason, retryAfterSeconds: Math.ceil((rule.expiry - now) / 1000) }
      }
    }
    if (this.leases.size >= this.policy.concurrency) {
      return { allowed: false, reason: 'concurrency', retryAfterSeconds: Math.max(1, Math.ceil((Math.min(...this.leases.values()) - now) / 1000)) }
    }
    for (const rule of rules) this.counters.set(rule.key, { value: (this.counters.get(rule.key)?.value || 0) + rule.amount, expiresAt: rule.expiry })
    this.leases.set(input.id, now + input.leaseMs)
    return { allowed: true, release: async () => { this.leases.delete(input.id) } }
  }
}

export function createAiAdmission(env: AiEnv, config: AiConfig): AiAdmission {
  if (config.admissionStore === 'memory') return new MemoryAiAdmission(config)
  const redis = resolveRedisConfig(env)
  if (!redis) throw new AiAdmissionUnavailable('AI protection requires Redis')
  return new RedisAiAdmission(redisClient(redis), config)
}
