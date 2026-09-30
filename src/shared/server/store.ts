// Chart storage. Upstash Redis in production (Vercel Marketplace / KV env vars);
// an in-memory store (optionally file-backed) for local development and tests.
// Production refuses to start without Redis instead of silently losing charts.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Redis } from '@upstash/redis'
import type { Chart } from '../flowTypes.js'

export interface StoredRecord {
  chart: Chart
  /** SHA-256 (hex) of the chart's edit token. Never returned to clients. */
  tokenHash: string
  /** Size of the stored chart JSON in bytes (for the storage-growth budget). */
  bytes?: number
}

export type UpdateResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'conflict'; currentVersion: number }

export interface FlowStore {
  readonly kind: 'upstash' | 'memory' | 'file'
  readonly description: string
  /** Insert a new chart. Resolves false if the id is already taken. */
  create(record: StoredRecord): Promise<boolean>
  get(id: string): Promise<StoredRecord | null>
  /** Cheap lookup of just the version, for polling. */
  getVersion(id: string): Promise<number | null>
  /** Atomically replace a chart if its stored version still equals expectedVersion. */
  update(id: string, expectedVersion: number, chart: Chart): Promise<UpdateResult>
}

export class StorageNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageNotConfiguredError'
  }
}

/** Redis could not be reached or refused the command (for example, a free-tier quota ran out). */
export class StorageUnavailableError extends Error {
  constructor(
    message: string,
    /** The Redis error, e.g. "ERR max requests limit exceeded". Logged, never sent to clients. */
    readonly detail: string,
    options?: { cause?: unknown },
  ) {
    super(message)
    this.name = 'StorageUnavailableError'
    // Not super(message, options): Vercel type-checks functions against the ES2020 lib,
    // which has no Error options.
    if (options && 'cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, writable: true, configurable: true })
    }
  }
}

export const STORAGE_UNAVAILABLE_MESSAGE =
  'Chart storage is temporarily unavailable. Try again in a minute; if this keeps happening, the service may have reached a hosting quota.'

const QUOTA_ERROR = /max (?:daily |monthly )?requests? limit|max (?:database|db|data) ?size|bandwidth limit|OOM/i

type Env = Record<string, string | undefined>

// ---------------------------------------------------------------------------
// In-memory (and file-backed) store
// ---------------------------------------------------------------------------

interface MemoryEntry {
  data: string
  version: number
  tokenHash: string
}

export class MemoryFlowStore implements FlowStore {
  readonly kind: 'memory' | 'file' = 'memory'
  readonly description: string = 'in-memory (development only; charts are lost when the process restarts)'
  protected entries = new Map<string, MemoryEntry>()

  async create(record: StoredRecord): Promise<boolean> {
    if (this.entries.has(record.chart.id)) return false
    this.entries.set(record.chart.id, {
      data: JSON.stringify(record.chart),
      version: record.chart.version,
      tokenHash: record.tokenHash,
    })
    this.persist()
    return true
  }

  async get(id: string): Promise<StoredRecord | null> {
    const entry = this.entries.get(id)
    if (!entry) return null
    return { chart: JSON.parse(entry.data) as Chart, tokenHash: entry.tokenHash, bytes: Buffer.byteLength(entry.data, 'utf8') }
  }

  async getVersion(id: string): Promise<number | null> {
    return this.entries.get(id)?.version ?? null
  }

  async update(id: string, expectedVersion: number, chart: Chart): Promise<UpdateResult> {
    // Check-and-set runs synchronously, so it is atomic within this process.
    const entry = this.entries.get(id)
    if (!entry) return { ok: false, reason: 'not_found' }
    if (entry.version !== expectedVersion) return { ok: false, reason: 'conflict', currentVersion: entry.version }
    this.entries.set(id, { data: JSON.stringify(chart), version: chart.version, tokenHash: entry.tokenHash })
    this.persist()
    return { ok: true }
  }

  protected persist(): void {
    // no-op for the pure in-memory store
  }
}

/** Memory store mirrored to a JSON file so charts survive dev-server restarts. */
export class FileFlowStore extends MemoryFlowStore {
  readonly kind = 'file' as const
  readonly description: string

  constructor(readonly filePath: string) {
    super()
    this.description = `file-backed in-memory store at ${filePath} (development only)`
    if (existsSync(filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, MemoryEntry>
        this.entries = new Map(Object.entries(parsed))
      } catch (err) {
        console.warn(`[flowchart] Could not read ${filePath}; starting with an empty store.`, err)
      }
    }
  }

  protected persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.entries)))
    renameSync(tmp, this.filePath)
  }
}

// ---------------------------------------------------------------------------
// Upstash Redis store
// ---------------------------------------------------------------------------

/** Minimal slice of the @upstash/redis client used here (lets tests substitute a fake). */
export interface RedisLike {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>
  hmget(key: string, ...fields: string[]): Promise<unknown>
  hget(key: string, field: string): Promise<unknown>
}

// A chart is one hash: data (chart JSON), version, tokenHash. Scripts keep
// create and compare-and-set atomic on the Redis side.
export const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], 'data', ARGV[1], 'version', ARGV[2], 'tokenHash', ARGV[3])
local ttl = tonumber(ARGV[4])
if ttl and ttl > 0 then redis.call('EXPIRE', KEYS[1], ttl) end
return 1
`

export const UPDATE_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'version')
if not current then return {-1} end
if tonumber(current) ~= tonumber(ARGV[1]) then return {0, tonumber(current)} end
redis.call('HSET', KEYS[1], 'data', ARGV[2], 'version', ARGV[3])
local ttl = tonumber(ARGV[4])
if ttl and ttl > 0 then redis.call('EXPIRE', KEYS[1], ttl) end
return {1}
`

export class UpstashFlowStore implements FlowStore {
  readonly kind = 'upstash' as const
  readonly description: string
  private lastErrorLog = 0

  constructor(
    private readonly redis: RedisLike,
    source: string,
    private readonly ttlSeconds = 0,
    private readonly prefix = 'flowchart:flow:',
  ) {
    this.description = `Upstash Redis (${source})`
  }

  private key(id: string): string {
    return `${this.prefix}${id}`
  }

  /** Runs a Redis call, turning failures into StorageUnavailableError (logged at most once a minute). */
  private async call<T>(what: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const now = Date.now()
      if (now - this.lastErrorLog > 60_000) {
        this.lastErrorLog = now
        const hint = QUOTA_ERROR.test(detail)
          ? ' This looks like an Upstash plan limit (commands, storage or bandwidth); see docs/mcp.md#capacity-and-costs.'
          : ''
        console.error(`[flowchart] Redis ${what} failed: ${detail}.${hint}`)
      }
      throw new StorageUnavailableError(STORAGE_UNAVAILABLE_MESSAGE, detail, { cause: err })
    }
  }

  async create(record: StoredRecord): Promise<boolean> {
    const result = await this.call('create', () =>
      this.redis.eval(
        CREATE_SCRIPT,
        [this.key(record.chart.id)],
        [JSON.stringify(record.chart), String(record.chart.version), record.tokenHash, String(this.ttlSeconds)],
      ),
    )
    return Number(result) === 1
  }

  async get(id: string): Promise<StoredRecord | null> {
    const raw = await this.call('read', () => this.redis.hmget(this.key(id), 'data', 'version', 'tokenHash'))
    if (raw === null || raw === undefined) return null
    const values = Array.isArray(raw)
      ? raw
      : [(raw as Record<string, unknown>).data, (raw as Record<string, unknown>).version, (raw as Record<string, unknown>).tokenHash]
    const [data, , tokenHash] = values
    if (data === null || data === undefined) return null
    const text = typeof data === 'string' ? data : JSON.stringify(data)
    return { chart: JSON.parse(text) as Chart, tokenHash: String(tokenHash ?? ''), bytes: Buffer.byteLength(text, 'utf8') }
  }

  async getVersion(id: string): Promise<number | null> {
    const raw = await this.call('version read', () => this.redis.hget(this.key(id), 'version'))
    if (raw === null || raw === undefined) return null
    const version = Number(raw)
    return Number.isFinite(version) ? version : null
  }

  async update(id: string, expectedVersion: number, chart: Chart): Promise<UpdateResult> {
    const result = await this.call('update', () =>
      this.redis.eval(
        UPDATE_SCRIPT,
        [this.key(id)],
        [String(expectedVersion), JSON.stringify(chart), String(chart.version), String(this.ttlSeconds)],
      ),
    )
    const [status, current] = (Array.isArray(result) ? result : [result]).map(Number)
    if (status === 1) return { ok: true }
    if (status === 0) return { ok: false, reason: 'conflict', currentVersion: current }
    return { ok: false, reason: 'not_found' }
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RedisConfig {
  url: string
  token: string
  /** Which variables supplied it, for logs. */
  source: string
}

/** KV_REST_API_* (Vercel KV / Marketplace) or UPSTASH_REDIS_REST_* (Upstash console). */
export function resolveRedisConfig(env: Env): RedisConfig | null {
  const pairs: Array<[string, string]> = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ]
  for (const [urlVar, tokenVar] of pairs) {
    const url = env[urlVar]?.trim()
    const token = env[tokenVar]?.trim()
    if (url && token) return { url, token, source: `${urlVar}/${tokenVar}` }
  }
  return null
}

const redisClients = new Map<string, Redis>()

/** One Upstash REST client per database and process, shared by the store and the rate limiter. */
export function redisClient(config: RedisConfig): Redis {
  const key = `${config.url}\n${config.token}`
  let client = redisClients.get(key)
  if (!client) {
    client = new Redis({ url: config.url, token: config.token, automaticDeserialization: false })
    redisClients.set(key, client)
  }
  return client
}

function partialRedisConfig(env: Env): string | null {
  const pairs: Array<[string, string]> = [
    ['KV_REST_API_URL', 'KV_REST_API_TOKEN'],
    ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'],
  ]
  for (const [urlVar, tokenVar] of pairs) {
    if (!!env[urlVar]?.trim() !== !!env[tokenVar]?.trim()) {
      return `${env[urlVar]?.trim() ? urlVar : tokenVar} is set but ${env[urlVar]?.trim() ? tokenVar : urlVar} is missing`
    }
  }
  return null
}

/** Deployed to Vercel production/preview, or NODE_ENV=production elsewhere. */
export function isProductionEnv(env: Env): boolean {
  if (env.VERCEL_ENV) return env.VERCEL_ENV !== 'development'
  return env.NODE_ENV === 'production'
}

export const STORAGE_NOT_CONFIGURED_MESSAGE =
  'Chart storage is not configured. Connect Upstash Redis to this Vercel project (Storage > Marketplace > Upstash for Redis), ' +
  'which sets KV_REST_API_URL and KV_REST_API_TOKEN, or set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN, then redeploy.'

export function ttlSecondsFromEnv(env: Env): number {
  const days = Number(env.FLOW_TTL_DAYS ?? 0)
  return Number.isFinite(days) && days > 0 ? Math.round(days * 86_400) : 0
}

interface Logger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

const memoryStores = new Map<string, MemoryFlowStore>()
const globalStores = globalThis as typeof globalThis & { __flowchartMemoryStores?: Map<string, MemoryFlowStore> }

/** One memory store per process (and per file), shared across module reloads in the Vite dev server. */
function sharedMemoryStore(filePath?: string): MemoryFlowStore {
  const registry = (globalStores.__flowchartMemoryStores ??= memoryStores)
  const key = filePath ?? ':memory:'
  let store = registry.get(key)
  if (!store) {
    store = filePath ? new FileFlowStore(filePath) : new MemoryFlowStore()
    registry.set(key, store)
  }
  return store
}

export function createStoreFromEnv(env: Env = process.env, log: Logger = console): FlowStore {
  const config = resolveRedisConfig(env)
  if (config) {
    const store = new UpstashFlowStore(redisClient(config) as unknown as RedisLike, config.source, ttlSecondsFromEnv(env))
    log.info(`[flowchart] Storage: ${store.description}`)
    return store
  }

  const partial = partialRedisConfig(env)
  if (isProductionEnv(env) && env.FLOW_STORE !== 'memory') {
    const message = partial ? `${STORAGE_NOT_CONFIGURED_MESSAGE} (${partial})` : STORAGE_NOT_CONFIGURED_MESSAGE
    log.error(`[flowchart] ${message}`)
    throw new StorageNotConfiguredError(message)
  }
  if (partial) log.error(`[flowchart] Ignoring incomplete Redis configuration: ${partial}.`)

  const store = sharedMemoryStore(env.FLOW_STORE_FILE?.trim() || undefined)
  log.warn(`[flowchart] Storage: ${store.description}. Set KV_REST_API_URL/KV_REST_API_TOKEN to use Upstash Redis.`)
  return store
}
