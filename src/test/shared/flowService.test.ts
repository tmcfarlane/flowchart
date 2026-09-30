// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { FlowService, type ServiceError } from '../../shared/server/flowService'
import { MemoryFlowStore, type FlowStore } from '../../shared/server/store'
import { hashToken } from '../../shared/server/tokens'
import { LIMITS, type Chart } from '../../shared/flowTypes'
import type { NodeInput } from '../../shared/flowSchema'
import { layoutWorkUnits } from '../../shared/layout'

const NODES: NodeInput[] = [
  { id: 'start', type: 'step', label: 'Start' },
  { id: 'check', type: 'decision', label: 'Valid?' },
  { id: 'db', type: 'image', label: 'Cosmos DB', icon: 'cosmos' },
]
const EDGES = [
  { source: 'start', target: 'check' },
  { source: 'check', target: 'db', label: 'Yes' },
]

function setup(store: FlowStore = new MemoryFlowStore()) {
  let tick = 0
  const service = new FlowService({ store, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) })
  return { service, store }
}

async function created(service: FlowService) {
  const result = await service.create({ title: 'Signup', nodes: NODES, edges: EDGES, source: 'mcp' })
  if (!result.ok) throw new Error(result.message)
  return result
}

const failure = (result: unknown) => result as ServiceError

describe('FlowService.create', () => {
  it('validates, lays out and stores a chart with a hashed edit token', async () => {
    const { service, store } = setup()
    const result = await created(service)
    expect(result.chart).toMatchObject({ version: 1, title: 'Signup', updatedVia: 'mcp' })
    expect(result.chart.id).toMatch(/^[0-9A-Za-z]{10}$/)
    expect(result.layout).toBe('full')
    expect(result.chart.nodes.every((n) => n.position && n.width)).toBe(true)
    expect(result.chart.nodes.find((n) => n.id === 'db')?.icon).toBe('azure-cosmos-db')

    const record = await store.get(result.chart.id)
    expect(record?.tokenHash).toBe(hashToken(result.editToken))
    expect(JSON.stringify(record)).not.toContain(result.editToken)
    expect(await service.get(result.chart.id)).toEqual(result.chart)
  })

  it('returns every validation problem at once', async () => {
    const { service } = setup()
    const result = failure(
      await service.create({
        title: 'Bad',
        nodes: [
          { id: 'a', type: 'step', label: 'A', icon: 'cosmos' },
          { id: 'a', type: 'step', label: 'B' },
        ],
        edges: [{ source: 'a', target: 'nope' }],
        source: 'mcp',
      }),
    )
    expect(result.code).toBe('validation')
    expect(result.code === 'validation' && result.issues.map((i) => i.path)).toEqual([
      'nodes[1].id',
      'nodes[0].icon',
      'edges[0].target',
    ])
  })

  it('rejects charts over the size limit', async () => {
    const { service } = setup()
    const nodes = Array.from({ length: LIMITS.maxNodes }, (_, i) => ({
      id: `n${i}`,
      type: 'step' as const,
      label: 'x'.repeat(LIMITS.maxLabelLength),
      position: { x: 0, y: i * 100 },
    }))
    const result = failure(await service.create({ title: 'Huge', nodes, source: 'api' }))
    expect(result.code).toBe('too_large')
    expect(result.message).toContain('limit is 256 KB')
  })

  it('retries when a generated id is already taken', async () => {
    const ids = ['Dup0000000', 'Dup0000000', 'Fresh00000']
    const store = new MemoryFlowStore()
    const service = new FlowService({ store, generateId: () => ids.shift()! })
    const first = await service.create({ title: 'One', nodes: NODES, source: 'api' })
    const second = await service.create({ title: 'Two', nodes: NODES, source: 'api' })
    expect(first.ok && first.chart.id).toBe('Dup0000000')
    expect(second.ok && second.chart.id).toBe('Fresh00000')
  })
})

describe('FlowService updates', () => {
  it('requires the right edit token', async () => {
    const { service } = setup()
    const { chart } = await created(service)
    for (const token of [undefined, '', 'wrong-token']) {
      const result = failure(await service.replace(chart.id, token, { nodes: NODES, source: 'api' }))
      expect(result.code).toBe('unauthorized')
    }
  })

  it('reports unknown and malformed ids as not found', async () => {
    const { service } = setup()
    expect(failure(await service.replace('Nope000000', 't', { nodes: [], source: 'api' })).code).toBe('not_found')
    expect(failure(await service.applyOperations('../etc', 't', { operations: [], source: 'api' })).code).toBe('not_found')
    expect(await service.get('bad id')).toBeNull()
    expect(await service.getVersion('Nope000000')).toBeNull()
  })

  it('replaces the document and bumps the version', async () => {
    const { service } = setup()
    const { chart, editToken } = await created(service)
    const result = await service.replace(chart.id, editToken, {
      title: 'Renamed',
      nodes: chart.nodes,
      edges: chart.edges,
      expectedVersion: 1,
      source: 'api',
    })
    expect(result.ok && result.chart).toMatchObject({ version: 2, title: 'Renamed', updatedVia: 'api' })
    expect(result.ok && result.layout).toBe('none')
    expect(await service.getVersion(chart.id)).toBe(2)
  })

  it('rejects stale versions instead of overwriting (optimistic concurrency)', async () => {
    const { service } = setup()
    const { chart, editToken } = await created(service)
    await service.applyOperations(chart.id, editToken, {
      operations: [{ op: 'update_node', id: 'start', changes: { label: 'Browser edit' } }],
      source: 'api',
    })
    const stale = failure(
      await service.replace(chart.id, editToken, { nodes: NODES, edges: EDGES, expectedVersion: 1, source: 'mcp' }),
    )
    expect(stale).toMatchObject({ code: 'conflict', currentVersion: 2 })
    const staleOps = failure(
      await service.applyOperations(chart.id, editToken, {
        operations: [{ op: 'remove_node', id: 'db' }],
        expectedVersion: 1,
        source: 'mcp',
      }),
    )
    expect(staleOps).toMatchObject({ code: 'conflict', currentVersion: 2 })
    expect((await service.get(chart.id))?.nodes.find((n) => n.id === 'start')?.label).toBe('Browser edit')
  })

  it('applies operations, places new nodes and summarizes the change', async () => {
    const { service } = setup()
    const { chart, editToken } = await created(service)
    const result = await service.applyOperations(chart.id, editToken, {
      operations: [
        { op: 'add_node', node: { id: 'welcome', type: 'step', label: 'Send welcome email' } },
        { op: 'add_edge', edge: { source: 'db', target: 'welcome' } },
      ],
      title: 'Signup v2',
      expectedVersion: 1,
      source: 'mcp',
    })
    if (!result.ok) throw new Error(result.message)
    expect(result.chart.version).toBe(2)
    expect(result.layout).toBe('incremental')
    expect(result.summary).toEqual(['added node "welcome"', 'added edge db -> welcome', 'renamed to "Signup v2"'])
    const welcome = result.chart.nodes.find((n) => n.id === 'welcome')!
    const db = result.chart.nodes.find((n) => n.id === 'db')!
    expect(welcome.position.y).toBeGreaterThan(db.position.y)
  })

  it('reports semantic problems created by operations by node id', async () => {
    const { service } = setup()
    const { chart, editToken } = await created(service)
    const result = failure(
      await service.applyOperations(chart.id, editToken, {
        operations: [{ op: 'update_node', id: 'db', changes: { icon: 'not-a-real-icon' } }],
        source: 'mcp',
      }),
    )
    expect(result.code === 'validation' && result.issues[0].path).toBe('node "db".icon')
  })

  it('re-applies relative operations when another write lands first', async () => {
    const inner = new MemoryFlowStore()
    let interfere = true
    const { service } = setup({
      kind: inner.kind,
      description: inner.description,
      create: (r) => inner.create(r),
      get: (id) => inner.get(id),
      getVersion: (id) => inner.getVersion(id),
      async update(id, expected, next) {
        if (interfere) {
          // Simulate the browser saving between our read and our write.
          interfere = false
          const current = (await inner.get(id))!.chart
          await inner.update(id, current.version, { ...current, version: current.version + 1, title: 'Browser' } as Chart)
        }
        return inner.update(id, expected, next)
      },
    })
    const { chart, editToken } = await created(service)
    const result = await service.applyOperations(chart.id, editToken, {
      operations: [{ op: 'update_node', id: 'start', changes: { label: 'Agent edit' } }],
      source: 'mcp',
    })
    expect(result.ok && result.chart.version).toBe(3)
    expect(result.ok && result.chart.title).toBe('Browser')
  })

  it('enforces the node limit on operations', async () => {
    const { service } = setup()
    const nodes = Array.from({ length: LIMITS.maxNodes }, (_, i) => ({
      id: `n${i}`,
      type: 'step' as const,
      label: 'x',
      position: { x: (i % 20) * 200, y: Math.floor(i / 20) * 120 },
    }))
    const createdChart = await service.create({ title: 'Full', nodes, source: 'api' })
    if (!createdChart.ok) throw new Error(createdChart.message)
    const result = failure(
      await service.applyOperations(createdChart.chart.id, createdChart.editToken, {
        operations: [{ op: 'add_node', node: { id: 'extra', type: 'step', label: 'one too many' } }],
        source: 'mcp',
      }),
    )
    expect(result.code === 'validation' && result.issues[0].message).toContain(`exceed ${LIMITS.maxNodes} nodes`)
  })
})

describe('FlowService quotas', () => {
  function recordingQuota(refuse?: 'work' | 'growth') {
    const charges: Array<['work' | 'growth', number]> = []
    const decide = (kind: 'work' | 'growth') => async (amount: number) => {
      charges.push([kind, amount])
      return kind === refuse
        ? { allowed: false as const, retryAfterSeconds: 90, message: `Refused ${kind}. Try again in 90 seconds.` }
        : { allowed: true as const }
    }
    return { charges, quota: { work: decide('work'), growth: decide('growth') } }
  }

  it('charges extra work units for big automatic layouts before running them', async () => {
    const { service } = setup()
    const nodes = Array.from({ length: 120 }, (_, i) => ({ id: `n${i}`, type: 'step' as const, label: `Step ${i}` }))
    const edges = nodes.slice(1).map((n, i) => ({ source: `n${i}`, target: n.id }))
    const { charges, quota } = recordingQuota('work')
    const result = failure(await service.create({ title: 'Big', nodes, edges, source: 'mcp', quota }))
    expect(result).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 90, message: 'Refused work. Try again in 90 seconds.' })
    expect(charges).toEqual([['work', layoutWorkUnits({ layout: 'full', missing: 120 }, 120, 119) - 1]])

    // Small charts cost just the unit charged when the request arrived.
    const small = recordingQuota()
    expect((await service.create({ title: 'Small', nodes: NODES, edges: EDGES, source: 'mcp', quota: small.quota })).ok).toBe(true)
    expect(small.charges.map(([kind]) => kind)).toEqual(['growth'])
  })

  it('charges storage growth by the change in size, and nothing for small edits or shrinking', async () => {
    const { service, store } = setup()
    const { chart, editToken } = await created(service)
    const before = (await store.get(chart.id))!.bytes!
    const grow = recordingQuota()
    const grown = await service.applyOperations(chart.id, editToken, {
      operations: [{ op: 'add_node', node: { id: 'more', type: 'note', label: 'A long note. '.repeat(30) } }],
      source: 'mcp',
      quota: grow.quota,
    })
    if (!grown.ok) throw new Error(grown.message)
    const after = (await store.get(chart.id))!.bytes!
    expect(grow.charges).toEqual([['growth', after - before]])

    const small = recordingQuota()
    await service.applyOperations(chart.id, editToken, {
      operations: [{ op: 'update_node', id: 'start', changes: { label: 'Start here' } }],
      source: 'mcp',
      quota: small.quota,
    })
    expect(small.charges).toEqual([])

    const shrink = recordingQuota()
    await service.applyOperations(chart.id, editToken, {
      operations: [{ op: 'remove_node', id: 'more' }],
      source: 'mcp',
      quota: shrink.quota,
    })
    expect(shrink.charges).toEqual([])
  })

  it('refuses a write that would exceed the storage budget without storing it', async () => {
    const { service, store } = setup()
    const { chart, editToken } = await created(service)
    const { quota } = recordingQuota('growth')
    const result = failure(
      await service.applyOperations(chart.id, editToken, {
        operations: [{ op: 'add_node', node: { id: 'more', type: 'step', label: 'More '.repeat(80) } }],
        source: 'mcp',
        quota,
      }),
    )
    expect(result.code).toBe('rate_limited')
    expect((await store.get(chart.id))!.chart.version).toBe(1)
  })
})
