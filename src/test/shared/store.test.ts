// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CREATE_SCRIPT,
  FileFlowStore,
  MemoryFlowStore,
  STORAGE_UNAVAILABLE_MESSAGE,
  StorageNotConfiguredError,
  StorageUnavailableError,
  UPDATE_SCRIPT,
  UpstashFlowStore,
  createStoreFromEnv,
  isProductionEnv,
  resolveRedisConfig,
  ttlSecondsFromEnv,
  type FlowStore,
  type RedisLike,
} from '../../shared/server/store'
import type { Chart } from '../../shared/flowTypes'

const chart = (id: string, version = 1, title = 'Test'): Chart => ({
  id,
  version,
  title,
  nodes: [{ id: 'a', type: 'step', label: 'A', position: { x: 0, y: 0 } }],
  edges: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** Emulates the two Lua scripts and the hash commands the Upstash store uses. */
class FakeRedis implements RedisLike {
  hashes = new Map<string, Map<string, string>>()
  expirations = new Map<string, number>()

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    const [key] = keys
    const hash = this.hashes.get(key)
    const ttl = Number(args[args.length - 1])
    if (script === CREATE_SCRIPT) {
      if (hash) return 0
      this.hashes.set(key, new Map([['data', args[0]], ['version', args[1]], ['tokenHash', args[2]]]))
      if (ttl > 0) this.expirations.set(key, ttl)
      return 1
    }
    if (script === UPDATE_SCRIPT) {
      if (!hash) return [-1]
      const current = Number(hash.get('version'))
      if (current !== Number(args[0])) return [0, current]
      hash.set('data', args[1])
      hash.set('version', args[2])
      if (ttl > 0) this.expirations.set(key, ttl)
      return [1]
    }
    throw new Error('unexpected script')
  }

  async hmget(key: string, ...fields: string[]): Promise<unknown> {
    const hash = this.hashes.get(key)
    return fields.map((f) => hash?.get(f) ?? null)
  }

  async hget(key: string, field: string): Promise<unknown> {
    return this.hashes.get(key)?.get(field) ?? null
  }
}

async function exerciseStore(store: FlowStore) {
  expect(await store.create({ chart: chart('Aaaaaaaaa1'), tokenHash: 'h'.repeat(64) })).toBe(true)
  expect(await store.create({ chart: chart('Aaaaaaaaa1'), tokenHash: 'x' })).toBe(false)

  const record = await store.get('Aaaaaaaaa1')
  expect(record?.chart.title).toBe('Test')
  expect(record?.tokenHash).toBe('h'.repeat(64))
  expect(await store.getVersion('Aaaaaaaaa1')).toBe(1)
  expect(await store.get('Zzzzzzzzz9')).toBeNull()
  expect(await store.getVersion('Zzzzzzzzz9')).toBeNull()

  // Mutating a returned chart must not change what is stored.
  record!.chart.title = 'mutated'
  expect((await store.get('Aaaaaaaaa1'))?.chart.title).toBe('Test')

  expect(await store.update('Aaaaaaaaa1', 1, chart('Aaaaaaaaa1', 2, 'Second'))).toEqual({ ok: true })
  expect(await store.update('Aaaaaaaaa1', 1, chart('Aaaaaaaaa1', 2, 'Stale'))).toEqual({
    ok: false,
    reason: 'conflict',
    currentVersion: 2,
  })
  expect(await store.update('Zzzzzzzzz9', 1, chart('Zzzzzzzzz9', 2))).toEqual({ ok: false, reason: 'not_found' })
  expect((await store.get('Aaaaaaaaa1'))?.chart.title).toBe('Second')
  // The token hash survives updates.
  expect((await store.get('Aaaaaaaaa1'))?.tokenHash).toBe('h'.repeat(64))
}

describe('MemoryFlowStore', () => {
  it('creates, reads and compare-and-sets charts', async () => {
    await exerciseStore(new MemoryFlowStore())
  })
})

describe('FileFlowStore', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })))

  it('persists charts across instances (dev server restarts)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowchart-store-'))
    dirs.push(dir)
    const file = join(dir, 'nested', 'flows.json')
    await exerciseStore(new FileFlowStore(file))
    const reopened = new FileFlowStore(file)
    expect((await reopened.get('Aaaaaaaaa1'))?.chart.version).toBe(2)
  })
})

describe('UpstashFlowStore', () => {
  it('uses atomic scripts for create and compare-and-set', async () => {
    const redis = new FakeRedis()
    await exerciseStore(new UpstashFlowStore(redis, 'test'))
    expect([...redis.hashes.keys()]).toEqual(['flowchart:flow:Aaaaaaaaa1'])
  })

  it('refreshes the optional TTL on writes', async () => {
    const redis = new FakeRedis()
    const store = new UpstashFlowStore(redis, 'test', 86_400)
    await store.create({ chart: chart('Bbbbbbbbb2'), tokenHash: 'h' })
    expect(redis.expirations.get('flowchart:flow:Bbbbbbbbb2')).toBe(86_400)
  })

  it('accepts object-shaped hmget replies too', async () => {
    const redis = new FakeRedis()
    const store = new UpstashFlowStore(
      {
        ...redis,
        eval: redis.eval.bind(redis),
        hget: redis.hget.bind(redis),
        hmget: async () => ({ data: chart('Ccccccccc3'), version: 1, tokenHash: 'h' }),
      },
      'test',
    )
    expect((await store.get('Ccccccccc3'))?.chart.id).toBe('Ccccccccc3')
  })

  it('reports the stored size of each chart', async () => {
    const redis = new FakeRedis()
    const store = new UpstashFlowStore(redis, 'test')
    await store.create({ chart: chart('Ddddddddd4', 1, 'Größe'), tokenHash: 'h' })
    expect((await store.get('Ddddddddd4'))?.bytes).toBe(Buffer.byteLength(JSON.stringify(chart('Ddddddddd4', 1, 'Größe'))))
  })

  it('turns Redis failures into StorageUnavailableError and names quota problems in the log', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing: RedisLike = {
      eval: async () => {
        throw new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000')
      },
      hmget: async () => {
        throw new Error('ERR max requests limit exceeded. Limit: 500000, Usage: 500000')
      },
      hget: async () => {
        throw new Error('fetch failed')
      },
    }
    const store = new UpstashFlowStore(failing, 'test')
    const thrown = await store.get('Aaaaaaaaa1').catch((err: unknown) => err)
    expect(thrown).toBeInstanceOf(StorageUnavailableError)
    expect((thrown as StorageUnavailableError).message).toBe(STORAGE_UNAVAILABLE_MESSAGE)
    expect((thrown as StorageUnavailableError).detail).toContain('max requests limit exceeded')
    await expect(store.getVersion('Aaaaaaaaa1')).rejects.toBeInstanceOf(StorageUnavailableError)
    await expect(store.update('Aaaaaaaaa1', 1, chart('Aaaaaaaaa1', 2))).rejects.toBeInstanceOf(StorageUnavailableError)
    // Logged once per minute, with a pointer to the plan limits.
    expect(error).toHaveBeenCalledTimes(1)
    expect(String(error.mock.calls[0][0])).toContain('Upstash plan limit')
    error.mockRestore()
  })
})

describe('configuration', () => {
  const quiet = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

  it('reads either the Vercel KV or the Upstash variable names', () => {
    expect(resolveRedisConfig({ KV_REST_API_URL: 'https://kv', KV_REST_API_TOKEN: 't' })).toMatchObject({
      url: 'https://kv',
      source: 'KV_REST_API_URL/KV_REST_API_TOKEN',
    })
    expect(resolveRedisConfig({ UPSTASH_REDIS_REST_URL: 'https://up', UPSTASH_REDIS_REST_TOKEN: 't' })).toMatchObject({
      url: 'https://up',
    })
    expect(resolveRedisConfig({ KV_REST_API_URL: 'https://kv' })).toBeNull()
  })

  it('detects production deployments', () => {
    expect(isProductionEnv({ VERCEL_ENV: 'production' })).toBe(true)
    expect(isProductionEnv({ VERCEL_ENV: 'preview' })).toBe(true)
    expect(isProductionEnv({ VERCEL_ENV: 'development', NODE_ENV: 'production' })).toBe(false)
    expect(isProductionEnv({ NODE_ENV: 'production' })).toBe(true)
    expect(isProductionEnv({ NODE_ENV: 'test' })).toBe(false)
  })

  it('falls back to memory in development and says so', () => {
    const store = createStoreFromEnv({ NODE_ENV: 'development' }, quiet)
    expect(store.kind).toBe('memory')
    expect(quiet.warn).toHaveBeenCalledWith(expect.stringContaining('in-memory'))
  })

  it('uses a file-backed store when FLOW_STORE_FILE is set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'flowchart-store-'))
    const store = createStoreFromEnv({ FLOW_STORE_FILE: join(dir, 'flows.json') }, quiet)
    expect(store.kind).toBe('file')
    rmSync(dir, { recursive: true, force: true })
  })

  it('fails loudly in production without Redis instead of losing charts', () => {
    expect(() => createStoreFromEnv({ VERCEL_ENV: 'production' }, quiet)).toThrow(StorageNotConfiguredError)
    expect(quiet.error).toHaveBeenCalledWith(expect.stringContaining('KV_REST_API_URL'))
    expect(() => createStoreFromEnv({ VERCEL_ENV: 'production', UPSTASH_REDIS_REST_URL: 'https://x' }, quiet)).toThrow(
      /UPSTASH_REDIS_REST_TOKEN is missing/,
    )
    expect(createStoreFromEnv({ VERCEL_ENV: 'production', FLOW_STORE: 'memory' }, quiet).kind).toBe('memory')
  })

  it('uses Upstash when configured', () => {
    const store = createStoreFromEnv(
      { VERCEL_ENV: 'production', KV_REST_API_URL: 'https://example.upstash.io', KV_REST_API_TOKEN: 'token' },
      quiet,
    )
    expect(store.kind).toBe('upstash')
    expect(quiet.info).toHaveBeenCalledWith('[flowchart] Storage: Upstash Redis (KV_REST_API_URL/KV_REST_API_TOKEN)')
  })

  it('parses FLOW_TTL_DAYS', () => {
    expect(ttlSecondsFromEnv({})).toBe(0)
    expect(ttlSecondsFromEnv({ FLOW_TTL_DAYS: '2' })).toBe(172_800)
    expect(ttlSecondsFromEnv({ FLOW_TTL_DAYS: 'nope' })).toBe(0)
  })
})
