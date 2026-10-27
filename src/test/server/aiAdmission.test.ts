// @vitest-environment node
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MemoryAiAdmission, RedisAiAdmission, AiAdmissionUnavailable, type AiRedis } from '../../shared/server/aiAdmission'

const policy = { environment: 'test', clientPerMinute: 100, globalPerMinute: 100, dailyBudgetMicros: 500, concurrency: 2 }
const attempt = (id: string, costMicros = 100) => ({ id, client: '127.0.0.1', costMicros, leaseMs: 10000 })

describe('AI admission', () => {
  it('atomically admits only the available concurrent work', async () => {
    const gate = new MemoryAiAdmission(policy)
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => gate.acquire(attempt(String(i)))))
    expect(results.filter(result => result.allowed)).toHaveLength(2)
    expect(results.filter(result => !result.allowed && result.reason === 'concurrency')).toHaveLength(48)
  })

  it('retains spend after release and never admits a charge larger than the budget', async () => {
    const gate = new MemoryAiAdmission({ ...policy, dailyBudgetMicros: 100 })
    const first = await gate.acquire(attempt('a'))
    expect(first.allowed).toBe(true)
    if (first.allowed) await first.release()
    expect(await gate.acquire(attempt('b'))).toMatchObject({ allowed: false, reason: 'budget' })
    expect(await new MemoryAiAdmission(policy).acquire(attempt('too-large', 501))).toMatchObject({ allowed: false, reason: 'budget' })
  })

  it('release is idempotent and cannot release another attempt', async () => {
    const gate = new MemoryAiAdmission({ ...policy, concurrency: 1 })
    const first = await gate.acquire(attempt('a'))
    if (!first.allowed) throw new Error('first attempt denied')
    await first.release()
    const second = await gate.acquire(attempt('b'))
    expect(second.allowed).toBe(true)
    await first.release()
    expect(await gate.acquire(attempt('c'))).toMatchObject({ allowed: false, reason: 'concurrency' })
  })

  it('keeps concurrency across midnight while daily allowance resets', async () => {
    let now = 86399000
    const gate = new MemoryAiAdmission({ ...policy, concurrency: 1, dailyBudgetMicros: 100 }, () => now)
    expect((await gate.acquire(attempt('before'))).allowed).toBe(true)
    now += 2000
    expect(await gate.acquire(attempt('after'))).toMatchObject({ allowed: false, reason: 'concurrency' })
    now += 10000
    expect((await gate.acquire(attempt('expired'))).allowed).toBe(true)
  })

  it('enforces per-client and global rates separately', async () => {
    const gate = new MemoryAiAdmission({ ...policy, clientPerMinute: 1, globalPerMinute: 2, concurrency: 10 })
    await gate.acquire(attempt('a'))
    expect(await gate.acquire(attempt('b'))).toMatchObject({ allowed: false, reason: 'client_rate' })
    await gate.acquire({ ...attempt('c'), client: '127.0.0.2' })
    expect(await gate.acquire({ ...attempt('d'), client: '127.0.0.3' })).toMatchObject({ allowed: false, reason: 'global_rate' })
  })

  it.each([undefined, null, [], [1, 3, 0], [0, 0, 0], [0, 4, -1], ['1', 0, 0]])('fails closed for malformed Redis reply %j', async reply => {
    const gate = new RedisAiAdmission({ eval: async () => reply }, policy)
    await expect(gate.acquire(attempt('a'))).rejects.toBeInstanceOf(AiAdmissionUnavailable)
  })

  it('fails closed on Redis failure', async () => {
    const gate = new RedisAiAdmission({ eval: async () => { throw new Error('secret backend error') } }, policy)
    await expect(gate.acquire(attempt('a'))).rejects.toThrow('AI protection is temporarily unavailable')
  })
})

const execFileAsync = promisify(execFile)
const redisUrl = process.env.AI_TEST_REDIS_URL
const integration = redisUrl ? describe : describe.skip
integration('AI admission with real Redis Lua', () => {
  function redis(): AiRedis {
    return {
      async eval(script, keys, args) {
        const { stdout } = await execFileAsync('redis-cli', ['-u', redisUrl!, '--json', 'EVAL', script, String(keys.length), ...keys, ...args.map(String)])
        return JSON.parse(stdout) as unknown
      },
    }
  }
  const environment = () => `test-${randomUUID()}`

  it('atomically caps 50 concurrent clients and releases only their unique leases', async () => {
    const gate = new RedisAiAdmission(redis(), { ...policy, environment: environment(), dailyBudgetMicros: 10000 })
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => gate.acquire({ ...attempt(String(i)), client: `192.0.2.${i + 1}` })))
    const accepted = results.filter(result => result.allowed)
    expect(accepted).toHaveLength(2)
    expect(results.filter(result => !result.allowed && result.reason === 'concurrency')).toHaveLength(48)
    if (!accepted[0].allowed) throw new Error('missing accepted attempt')
    await accepted[0].release()
    const next = await gate.acquire(attempt('next'))
    expect(next.allowed).toBe(true)
    await accepted[0].release()
    expect(await gate.acquire(attempt('still-full'))).toMatchObject({ allowed: false, reason: 'concurrency' })
  })

  it('atomically reserves the entire budget without concurrent overshoot or refunds', async () => {
    const gate = new RedisAiAdmission(redis(), { ...policy, environment: environment(), concurrency: 100 })
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => gate.acquire(attempt(String(i)))))
    const accepted = results.filter(result => result.allowed)
    expect(accepted).toHaveLength(5)
    expect(results.filter(result => !result.allowed && result.reason === 'budget')).toHaveLength(35)
    for (const result of accepted) if (result.allowed) await result.release()
    expect(await gate.acquire(attempt('after-release'))).toMatchObject({ allowed: false, reason: 'budget' })
  })

  it('expires abandoned leases and rejects corrupt Redis state', async () => {
    let now = Date.now()
    const service = redis()
    const env = environment()
    const gate = new RedisAiAdmission(service, { ...policy, environment: env, concurrency: 1 }, () => now)
    expect((await gate.acquire({ ...attempt('abandoned'), leaseMs: 1000 })).allowed).toBe(true)
    now += 1001
    expect((await gate.acquire(attempt('new'))).allowed).toBe(true)
    await service.eval("return redis.call('SET', KEYS[1], 'bad-number')", [`flowchart:ai:{${env}}:global:${Math.floor(now / 60000)}`], [])
    await expect(gate.acquire(attempt('corrupt'))).rejects.toBeInstanceOf(AiAdmissionUnavailable)
  })
})
