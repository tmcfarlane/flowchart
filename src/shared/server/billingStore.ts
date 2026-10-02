/** Billing writes fail closed. Unlike anonymous chart limits, paid entitlements and
 * spend reservations must remain atomic across serverless instances. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isProductionEnv, redisClient, resolveRedisConfig } from './store.js'

export interface BillingStore {
  read<T>(key: string): Promise<T | null>
  compareAndSet<T>(key: string, previous: T | null, next: T, ttlSeconds?: number): Promise<boolean>
}

export class BillingStorageError extends Error {
  constructor() { super('Premium storage is unavailable. Please try again later.') }
}

export async function billingUpdate<T, R>(
  store: BillingStore,
  key: string,
  update: (previous: T | null) => { next: T; result: R },
  ttlSeconds?: number,
): Promise<R> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const previous = await store.read<T>(key)
    const { next, result } = update(previous)
    if (await store.compareAndSet(key, previous, next, ttlSeconds)) return result
  }
  throw new BillingStorageError()
}

interface Entry { json: string; expiresAt: number }
export class MemoryBillingStore implements BillingStore {
  protected entries = new Map<string, Entry>()
  constructor(protected readonly now: () => number = Date.now) {}
  protected persist(): void {}
  async read<T>(key: string): Promise<T | null> {
    const entry = this.entries.get(key)
    if (!entry || (entry.expiresAt && entry.expiresAt <= this.now())) return null
    return JSON.parse(entry.json) as T
  }
  async compareAndSet<T>(key: string, previous: T | null, next: T, ttlSeconds = 0): Promise<boolean> {
    const entry = this.entries.get(key)
    const current = entry && (!entry.expiresAt || entry.expiresAt > this.now()) ? entry.json : null
    if (current !== (previous === null ? null : JSON.stringify(previous))) return false
    this.entries.set(key, { json: JSON.stringify(next), expiresAt: ttlSeconds ? this.now() + ttlSeconds * 1000 : 0 })
    try { this.persist() } catch (error) {
      if (entry) this.entries.set(key, entry)
      else this.entries.delete(key)
      throw error
    }
    return true
  }
}

/** Single-process development only; malformed persisted billing state fails closed. */
export class FileBillingStore extends MemoryBillingStore {
  constructor(readonly filePath: string, now = Date.now) {
    super(now)
    if (existsSync(filePath)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid store')
        this.entries = new Map(Object.entries(parsed as Record<string, Entry>))
        for (const entry of this.entries.values()) {
          if (typeof entry.json !== 'string' || typeof entry.expiresAt !== 'number') throw new Error('Invalid entry')
          JSON.parse(entry.json)
        }
      } catch { throw new BillingStorageError() }
    }
  }
  protected persist() {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      const temporary = `${this.filePath}.${randomBytes(8).toString('hex')}.tmp`
      writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.entries)), { mode: 0o600 })
      renameSync(temporary, this.filePath)
    } catch { throw new BillingStorageError() }
  }
}

export const BILLING_CAS_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if (not current and ARGV[1] ~= '') or (current and current ~= ARGV[1]) then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
if tonumber(ARGV[3]) > 0 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
return 1
`
interface BillingRedis { get(key: string): Promise<unknown>; eval(script: string, keys: string[], args: string[]): Promise<unknown> }
export class RedisBillingStore implements BillingStore {
  constructor(private readonly redis: BillingRedis) {}
  async read<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(`flowchart:billing:${key}`)
      return raw == null ? null : (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
    } catch { throw new BillingStorageError() }
  }
  async compareAndSet<T>(key: string, previous: T | null, next: T, ttlSeconds = 0): Promise<boolean> {
    try {
      return Number(await this.redis.eval(BILLING_CAS_SCRIPT, [`flowchart:billing:${key}`],
        [previous === null ? '' : JSON.stringify(previous), JSON.stringify(next), String(ttlSeconds)])) === 1
    } catch { throw new BillingStorageError() }
  }
}

type Env = Record<string, string | undefined>
const registry = globalThis as typeof globalThis & { __flowchartBillingStores?: Map<string, BillingStore> }
export function billingStoreFromEnv(env: Env): BillingStore {
  const redis = resolveRedisConfig(env)
  if (redis) return new RedisBillingStore(redisClient(redis) as unknown as BillingRedis)
  // Never allow an in-memory payment entitlement in production, even FLOW_STORE=memory.
  if (isProductionEnv(env)) throw new BillingStorageError()
  const path = env.BILLING_STORE_FILE?.trim()
  if (!path) throw new BillingStorageError()
  const stores = (registry.__flowchartBillingStores ??= new Map())
  let store = stores.get(path)
  if (!store) { store = new FileBillingStore(path); stores.set(path, store) }
  return store
}
