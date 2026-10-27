import { describe, expect, it } from 'vitest'
import type { ChartEdge, ChartNode } from '../../shared/flowTypes'
import { selectionScopeError, validateSelectionEdit, type SelectionEditScope } from '../../shared/selectionEdit'

const nodes: ChartNode[] = [
  { id: 'a', type: 'service', label: 'Long API service name', position: { x: 0.1234, y: -30.9876 }, width: 180, height: 90, icon: 'app-services' },
  { id: 'b', type: 'database', label: 'Orders database', position: { x: 300, y: 0 }, width: 160, height: 100, icon: 'azure-cosmos-db' },
  { id: 'outside', type: 'service', label: 'Untouched outside node', position: { x: 600, y: 0 } },
]
const edges: ChartEdge[] = [
  { id: 'internal', source: 'a', target: 'b', label: 'Query', protocol: 'SQL', commStyle: 'sync', style: 'default' },
  { id: 'boundary', source: 'b', target: 'outside', label: 'Notify', protocol: 'event', commStyle: 'async', style: 'default' },
]
const scope = (extra: Partial<SelectionEditScope> = {}): SelectionEditScope => ({ nodeIds: ['a', 'b'], edgeIds: ['internal'], snapshotId: 'frozen-request', revision: 7, ...extra })
const proposal = (operations: unknown[]) => ({ summary: 'Edit selected nodes in place', operations })
const rename = { op: 'update_node', id: 'a', changes: { label: 'API' } }

describe('selected-node AI edit scope', () => {
  it('accepts an explicit no-op explanation without changing the captured graph', () => {
    const result = validateSelectionEdit(nodes, edges, scope(), { summary: 'No changes are needed.', operations: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.proposal.operations).toEqual([])
    expect(result.result.nodes).toEqual(nodes)
    expect(result.result.edges).toEqual(edges)
  })

  it('renames existing IDs while preserving exact geometry, icons, hierarchy and unrelated records', () => {
    const before = JSON.stringify({ nodes, edges })
    const result = validateSelectionEdit(nodes, edges, scope(), proposal([rename, { op: 'update_node', id: 'b', changes: { label: 'Orders' } }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.proposal.operations[0]).toEqual(rename)
    expect(result.result.nodes).toHaveLength(nodes.length)
    expect(result.result.nodes[0]).toEqual({ ...nodes[0], label: 'API' })
    expect(result.result.nodes[1]).toEqual({ ...nodes[1], label: 'Orders' })
    expect(result.result.nodes[2]).toEqual(nodes[2])
    expect(result.result.edges).toEqual(edges)
    expect(JSON.stringify({ nodes, edges })).toBe(before)
  })

  it('distinguishes omitted patch fields from explicit null removal', () => {
    const result = validateSelectionEdit(nodes, edges, scope(), proposal([{ op: 'update_node', id: 'a', changes: { width: null, icon: null } }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.result.nodes[0]).not.toHaveProperty('width')
    expect(result.result.nodes[0]).not.toHaveProperty('icon')
    expect(result.result.nodes[0].height).toBe(nodes[0].height)
    expect(result.result.nodes[0].position).toEqual(nodes[0].position)
  })

  it.each([
    scope({ nodeIds: [] }), scope({ nodeIds: ['a', 'a'] }), scope({ nodeIds: ['missing'] }),
    scope({ edgeIds: ['missing'] }), scope({ edgeIds: ['internal', 'internal'] }),
  ])('rejects empty, duplicate and missing scope IDs before applying anything', invalidScope => {
    expect(validateSelectionEdit(nodes, edges, invalidScope, proposal([rename])).ok).toBe(false)
  })

  it('does not permit an unrelated edge to broaden the scope', () => {
    const unrelated: ChartEdge = { id: 'unrelated', source: 'b', target: 'outside' }
    expect(selectionScopeError(nodes, [unrelated], scope({ nodeIds: ['a'], edgeIds: ['unrelated'] }))).toContain('touching selected')
  })

  it.each([
    { op: 'update_node', id: 'outside', changes: { label: 'Do not edit' } },
    { op: 'remove_node', id: 'outside' },
    { op: 'update_edge', id: 'boundary', changes: { label: 'Do not edit' } },
    { op: 'remove_edge', id: 'boundary' },
  ])('rejects explicit operations outside selected node / approved edge IDs', operation => {
    expect(validateSelectionEdit(nodes, edges, scope(), proposal([operation])).ok).toBe(false)
  })

  it('detects implicit boundary-edge deletion and accepts it only after deliberate inclusion', () => {
    const deletion = proposal([{ op: 'remove_node', id: 'b' }])
    expect(validateSelectionEdit(nodes, edges, scope(), deletion)).toMatchObject({ ok: false, error: expect.stringContaining('connection outside') })
    const included = validateSelectionEdit(nodes, edges, scope({ edgeIds: ['internal', 'boundary'] }), deletion)
    expect(included.ok).toBe(true)
    if (!included.ok) throw new Error(included.error)
    expect(included.result.nodes.map(node => node.id)).toEqual(['a', 'outside'])
    expect(included.result.edges).toEqual([])
    expect(included.result.nodes[1]).toEqual(nodes[2])
  })

  it('rejects implicit changes to unselected container children', () => {
    const nested: ChartNode[] = [
      { id: 'box', type: 'container', label: 'Boundary', position: { x: 100, y: 50 }, containerKind: 'vpc' },
      { id: 'child', type: 'service', label: 'API', parentNode: 'box', position: { x: 20, y: 30 } },
    ]
    const result = validateSelectionEdit(nested, [], scope({ nodeIds: ['box'], edgeIds: [] }), proposal([{ op: 'remove_node', id: 'box' }]))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('unselected node') })
    expect(nested[1]).toMatchObject({ parentNode: 'box', position: { x: 20, y: 30 } })
  })

  it('rejects moving a selected container when an unselected child would move in world space', () => {
    const nested: ChartNode[] = [
      { id: 'box', type: 'container', label: 'Boundary', position: { x: 100, y: 50 }, width: 420, height: 300 },
      { id: 'child', type: 'service', label: 'API', parentNode: 'box', position: { x: 20, y: 30 } },
    ]
    const moved = proposal([{ op: 'update_node', id: 'box', changes: { position: { x: 200, y: 50 } } }])
    expect(validateSelectionEdit(nested, [], scope({ nodeIds: ['box'], edgeIds: [] }), moved)).toMatchObject({ ok: false, error: expect.stringContaining('unselected descendant') })
    expect(validateSelectionEdit(nested, [], scope({ nodeIds: ['box', 'child'], edgeIds: [] }), moved).ok).toBe(true)
    expect(nested[1].position).toEqual({ x: 20, y: 30 })
  })

  it.each([{ width: 300 }, { height: 200 }, { width: null }])('rejects ancestor resizing or default-size resets that could clamp an unselected child', changes => {
    const nested: ChartNode[] = [
      { id: 'box', type: 'container', label: 'Boundary', position: { x: 100, y: 50 }, width: 420, height: 300 },
      { id: 'child', type: 'service', label: 'API', parentNode: 'box', position: { x: 320, y: 220 } },
    ]
    const resized = proposal([{ op: 'update_node', id: 'box', changes }])
    expect(validateSelectionEdit(nested, [], scope({ nodeIds: ['box'], edgeIds: [] }), resized)).toMatchObject({ ok: false, error: expect.stringContaining('unselected node') })
    expect(validateSelectionEdit(nested, [], scope({ nodeIds: ['box', 'child'], edgeIds: [] }), resized).ok).toBe(true)
  })

  it('checks indirect descendants when all intermediate containers are selected', () => {
    const nested: ChartNode[] = [
      { id: 'outer', type: 'container', label: 'Outer', position: { x: 100, y: 50 }, width: 600, height: 400 },
      { id: 'inner', type: 'container', label: 'Inner', parentNode: 'outer', position: { x: 20, y: 30 }, width: 300, height: 200 },
      { id: 'leaf', type: 'service', label: 'API', parentNode: 'inner', position: { x: 5, y: 7 } },
    ]
    const selected = scope({ nodeIds: ['outer', 'inner'], edgeIds: [] })
    const moved = proposal([{ op: 'update_node', id: 'outer', changes: { position: { x: -40, y: -50 } } }])
    const resized = proposal([{ op: 'update_node', id: 'outer', changes: { width: 500 } }])
    expect(validateSelectionEdit(nested, [], selected, moved)).toMatchObject({ ok: false, error: expect.stringContaining('unselected descendant') })
    expect(validateSelectionEdit(nested, [], selected, resized)).toMatchObject({ ok: false, error: expect.stringContaining('unselected node') })
  })

  it('permits a selected container to detach while its unselected descendants retain world geometry and ancestor sizes', () => {
    const nested: ChartNode[] = [
      { id: 'outer', type: 'container', label: 'Outer', position: { x: 100.1, y: 50.2 }, width: 600, height: 400 },
      { id: 'inner', type: 'container', label: 'Inner', parentNode: 'outer', position: { x: 20.2, y: 30.3 }, width: 300, height: 200 },
      { id: 'leaf', type: 'service', label: 'API', parentNode: 'inner', position: { x: 5.3, y: 7.4 } },
    ]
    const result = validateSelectionEdit(nested, [], scope({ nodeIds: ['inner'], edgeIds: [] }), proposal([{ op: 'update_node', id: 'inner', changes: { parentNode: null } }]))
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error(result.error)
    expect(result.result.nodes[2]).toEqual(nested[2])
    expect(result.result.nodes[1].position!.x).toBeCloseTo(120.3)
    expect(result.result.nodes[1]).not.toHaveProperty('parentNode')
  })

  it('rejects a new ancestor extent that could clamp a selected container and its unselected descendants', () => {
    const nested: ChartNode[] = [
      { id: 'outer', type: 'container', label: 'Outer', position: { x: 0, y: 0 }, width: 600, height: 400 },
      { id: 'inner', type: 'container', label: 'Inner', parentNode: 'outer', position: { x: 300, y: 0 }, width: 400, height: 200 },
      { id: 'target', type: 'container', label: 'Narrow target', position: { x: 0, y: 0 }, width: 200, height: 200 },
      { id: 'leaf', type: 'service', label: 'API', parentNode: 'inner', position: { x: 10, y: 20 } },
    ]
    const result = validateSelectionEdit(nested, [], scope({ nodeIds: ['inner', 'target'], edgeIds: [] }), proposal([{ op: 'update_node', id: 'inner', changes: { parentNode: 'target', position: { x: 300, y: 0 } } }]))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('new ancestor extent') })
  })

  it('supports explicitly positioned additions and approved boundary endpoints without editing neighboring nodes', () => {
    const edit = proposal([
      { op: 'add_node', node: { id: 'new', type: 'queue', label: 'Events', position: { x: 450, y: 200 } } },
      { op: 'add_edge', edge: { id: 'new-edge', source: 'new', target: 'outside', protocol: 'event', commStyle: 'async' } },
    ])
    expect(validateSelectionEdit(nodes, edges, scope(), edit).ok).toBe(false)
    const accepted = validateSelectionEdit(nodes, edges, scope({ edgeIds: ['internal', 'boundary'] }), edit)
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) throw new Error(accepted.error)
    expect(accepted.result.nodes.slice(0, 3)).toEqual(nodes)
    expect(accepted.result.nodes[3]).toMatchObject({ id: 'new', position: { x: 450, y: 200 } })
    expect(accepted.result.edges[2]).toMatchObject({ id: 'new-edge', source: 'new', target: 'outside', protocol: 'event' })
  })

  it.each([
    { op: 'add_node', node: { id: 'new', type: 'step', label: 'Needs layout' } },
    { op: 'add_node', node: { id: 'a', type: 'step', label: 'Collision', position: { x: 0, y: 0 } } },
    { op: 'add_edge', edge: { source: 'a', target: 'b' } },
    { op: 'update_node', id: 'a', changes: { position: null } },
    { op: 'update_node', id: 'a', changes: { unexpected: 'field' } },
  ])('rejects malformed operations, collisions and automatic placement', operation => {
    expect(validateSelectionEdit(nodes, edges, scope(), proposal([operation])).ok).toBe(false)
  })

  it('rejects parent changes outside scope and container cycles', () => {
    const nested: ChartNode[] = [
      { id: 'outer', type: 'container', label: 'Outer', position: { x: 0, y: 0 } },
      { id: 'inner', type: 'container', label: 'Inner', position: { x: 20, y: 30 }, parentNode: 'outer' },
      { id: 'other', type: 'container', label: 'Other', position: { x: 600, y: 0 } },
    ]
    const selected = scope({ nodeIds: ['outer', 'inner'], edgeIds: [] })
    expect(validateSelectionEdit(nested, [], selected, proposal([{ op: 'update_node', id: 'inner', changes: { parentNode: 'other', position: { x: 10, y: 10 } } }])).ok).toBe(false)
    expect(validateSelectionEdit(nested, [], selected, proposal([{ op: 'update_node', id: 'outer', changes: { parentNode: 'inner', position: { x: 10, y: 10 } } }])).ok).toBe(false)
  })

  it('allows renaming an existing image whose binary content is omitted from AI context', () => {
    const image: ChartNode = { id: 'upload', type: 'image', label: 'Uploaded image', position: { x: 0, y: 0 } }
    const selected = scope({ nodeIds: ['upload'], edgeIds: [] })
    const accepted = validateSelectionEdit([image], [], selected, proposal([{ op: 'update_node', id: 'upload', changes: { label: 'Logo' } }]))
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) throw new Error(accepted.error)
    expect(accepted.result.nodes[0]).toEqual({ ...image, label: 'Logo' })
    expect(accepted.result.nodes[0]).not.toHaveProperty('imageUrl')
    expect(validateSelectionEdit([image], [], selected, proposal([{ op: 'update_node', id: 'upload', changes: { imageUrl: null } }])).ok).toBe(false)
  })

  it('never treats an approved neighboring endpoint as an editable node', () => {
    expect(validateSelectionEdit(nodes, edges, scope({ edgeIds: ['internal', 'boundary'] }), proposal([{ op: 'update_node', id: 'outside', changes: { label: 'No' } }])).ok).toBe(false)
  })
})
