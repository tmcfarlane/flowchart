// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { applyOperations } from '../../shared/patch'
import type { ChartEdge, ChartNode } from '../../shared/flowTypes'

const nodes: ChartNode[] = [
  { id: 'vpc', type: 'container', label: 'VPC', position: { x: 100, y: 100 }, width: 400, height: 300, containerKind: 'vpc' },
  { id: 'api', type: 'service', label: 'API', position: { x: 30, y: 60 }, parentNode: 'vpc' },
  { id: 'db', type: 'database', label: 'DB', position: { x: 30, y: 180 }, parentNode: 'vpc', icon: 'azure-cosmos-db' },
  { id: 'user', type: 'externalActor', label: 'User', position: { x: 0, y: 0 } },
]
const edges: ChartEdge[] = [
  { id: 'e1', source: 'user', target: 'api', sourceHandle: 'right', targetHandle: 'left' },
  { id: 'e2', source: 'api', target: 'db', label: 'SQL' },
]

describe('applyOperations', () => {
  it('adds nodes and edges, marking unpositioned nodes for placement', () => {
    const result = applyOperations(nodes, edges, [
      { op: 'add_node', node: { id: 'cache', type: 'cache', label: 'Redis', parentNode: 'vpc' } },
      { op: 'add_edge', edge: { source: 'api', target: 'cache' } },
    ])
    expect(result.ok).toBe(true)
    expect(result.nodes.find((n) => n.id === 'cache')).toMatchObject({ parentNode: 'vpc' })
    expect([...result.needsPlacement]).toEqual(['cache'])
    expect(result.edges).toHaveLength(3)
    expect(result.summary).toEqual(['added node "cache"', 'added edge api -> cache'])
  })

  it('rejects a duplicate node id and names the operation', () => {
    const result = applyOperations(nodes, edges, [
      { op: 'update_node', id: 'api', changes: { label: 'Orders API' } },
      { op: 'add_node', node: { id: 'db', type: 'step', label: 'dup' } },
    ])
    expect(result.ok).toBe(false)
    expect(result.issues[0].path).toBe('operations[1] (add_node)')
    expect(result.issues[0].message).toContain('a node with id "db" already exists')
  })

  it('does not mutate its inputs, even when a later operation fails', () => {
    const snapshot = JSON.stringify({ nodes, edges })
    applyOperations(nodes, edges, [
      { op: 'update_node', id: 'api', changes: { label: 'Changed' } },
      { op: 'remove_node', id: 'missing' },
    ])
    expect(JSON.stringify({ nodes, edges })).toBe(snapshot)
  })

  it('updates nodes: label, type (dropping icons it cannot show), size reset', () => {
    const result = applyOperations(nodes, edges, [
      { op: 'update_node', id: 'db', changes: { type: 'step', width: null } },
      { op: 'update_node', id: 'api', changes: { label: 'Orders API', width: 220 } },
    ])
    const db = result.nodes.find((n) => n.id === 'db')!
    expect(db.type).toBe('step')
    expect(db.icon).toBeUndefined()
    expect(result.nodes.find((n) => n.id === 'api')).toMatchObject({ label: 'Orders API', width: 220 })
  })

  it('detaches a node to its absolute position and re-places a node moved into a container', () => {
    const result = applyOperations(nodes, edges, [
      { op: 'update_node', id: 'api', changes: { parentNode: null } },
      { op: 'update_node', id: 'user', changes: { parentNode: 'vpc' } },
    ])
    expect(result.nodes.find((n) => n.id === 'api')).toMatchObject({ position: { x: 130, y: 160 } })
    expect(result.nodes.find((n) => n.id === 'api')!.parentNode).toBeUndefined()
    const user = result.nodes.find((n) => n.id === 'user')!
    expect(user.parentNode).toBe('vpc')
    expect(user.position).toBeUndefined()
    expect(result.needsPlacement.has('user')).toBe(true)
  })

  it('removes a node with its edges and keeps children of a removed container', () => {
    const result = applyOperations(nodes, edges, [{ op: 'remove_node', id: 'vpc' }])
    expect(result.ok).toBe(true)
    expect(result.nodes.map((n) => n.id)).toEqual(['api', 'db', 'user'])
    expect(result.nodes.find((n) => n.id === 'db')).toMatchObject({ position: { x: 130, y: 280 } })
    expect(result.nodes.find((n) => n.id === 'db')!.parentNode).toBeUndefined()

    const cascade = applyOperations(nodes, edges, [{ op: 'remove_node', id: 'api' }])
    expect(cascade.edges).toEqual([])
    expect(cascade.summary[0]).toBe('removed node "api" and 2 connected edges')
  })

  it('validates edge operations', () => {
    const unknownSource = applyOperations(nodes, edges, [{ op: 'add_edge', edge: { source: 'apii', target: 'db' } }])
    expect(unknownSource.issues[0].message).toContain('edge.source: no node with id "apii". Did you mean "api"?')

    const duplicateId = applyOperations(nodes, edges, [{ op: 'add_edge', edge: { id: 'e1', source: 'user', target: 'db' } }])
    expect(duplicateId.issues[0].message).toContain('an edge with id "e1" already exists')

    const missingEdge = applyOperations(nodes, edges, [{ op: 'remove_edge', id: 'e9' }])
    expect(missingEdge.issues[0].message).toBe('no edge with id "e9". Existing edge ids: "e1", "e2".')
  })

  it('updates edges: removes labels with null, clears handles when an end moves', () => {
    const result = applyOperations(nodes, edges, [
      { op: 'update_edge', id: 'e2', changes: { label: null, protocol: 'SQL', commStyle: 'sync' } },
      { op: 'update_edge', id: 'e1', changes: { target: 'db' } },
    ])
    expect(result.edges.find((e) => e.id === 'e2')).toEqual({
      id: 'e2',
      source: 'api',
      target: 'db',
      protocol: 'SQL',
      commStyle: 'sync',
    })
    const e1 = result.edges.find((e) => e.id === 'e1')!
    expect(e1).toMatchObject({ target: 'db', sourceHandle: 'right' })
    expect(e1.targetHandle).toBeUndefined()
  })

  it('rejects empty changes', () => {
    const result = applyOperations(nodes, edges, [{ op: 'update_node', id: 'api', changes: {} }])
    expect(result.issues[0].message).toContain('changes is empty')
  })

  it('refuses to turn a container with children into another type', () => {
    const result = applyOperations(nodes, edges, [{ op: 'update_node', id: 'vpc', changes: { type: 'step' } }])
    expect(result.issues[0].message).toContain('container "vpc" still holds "api", "db"')
  })
})
