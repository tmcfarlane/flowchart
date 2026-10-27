import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { validateSelectionEdit, type SelectionEditScope } from '../shared/selectionEdit'
import { authoredGraphSignature, captureSelectionEditSnapshot, mergeSelectionEditResult, selectionEditChart, selectionEditContext, selectionEditPreview, selectionEditSnapshotIsCurrent } from '../utils/selectionEdit'
import { parseFlowJson, serializeFlow } from '../utils/exportUtils'

const nodes: Node[] = [
  { id: 'a', type: 'service', position: { x: 12.123456, y: -24.987654 }, data: { label: 'Orders service with a long title', description: 'Keep custom metadata', onLabelChange: () => {} }, style: { width: 181.123456, height: 90.987654, background: '#ffedcc' }, selected: true, zIndex: 7 },
  { id: 'b', type: 'database', position: { x: 400.123456, y: 0.987654 }, data: { label: 'Unselected database', custom: { backup: true } }, style: { width: 170, height: 110 }, selected: false },
]
const edges: Edge[] = [{ id: 'ab', source: 'a', target: 'b', label: 'Read/write', animated: false, style: { stroke: '#bc1234', strokeWidth: 4 }, data: { protocol: 'SQL', commStyle: 'sync', custom: 123 }, markerEnd: { type: 'arrowclosed' as never, color: '#bc1234' } }]
const scope: SelectionEditScope = { nodeIds: ['a'], edgeIds: [], snapshotId: 'fixed-selection', revision: 4 }
const deps = { onLabelChange: () => {}, edgeProps: (_style: unknown, options?: { protocol?: string; commStyle?: string }): Partial<Edge> => ({ type: 'default', animated: options?.commStyle === 'async', style: { stroke: '#000', ...(options?.commStyle === 'async' ? { strokeDasharray: '5 5' } : {}) }, data: options }) }

describe('selected AI edit browser preservation', () => {
  it('merges a rename in place without rounding geometry or recreating unrelated objects', () => {
    const chart = selectionEditChart(nodes, edges)
    const validated = validateSelectionEdit(chart.nodes, chart.edges, scope, { summary: 'Shorter service name', operations: [{ op: 'update_node', id: 'a', changes: { label: 'Orders API' } }] })
    expect(validated.ok).toBe(true)
    if (!validated.ok) throw new Error(validated.error)
    const merged = mergeSelectionEditResult(nodes, edges, validated.result, deps)
    expect(merged.nodes).toHaveLength(2)
    expect(merged.nodes[0]).toMatchObject({ id: 'a', position: nodes[0].position, style: nodes[0].style, zIndex: 7, data: { label: 'Orders API', description: 'Keep custom metadata' } })
    expect(merged.nodes[0].position).toBe(nodes[0].position)
    expect(merged.nodes[1]).toBe(nodes[1])
    expect(merged.edges[0]).toBe(edges[0])
    expect(nodes[0].data.label).toBe('Orders service with a long title')
    const restored = parseFlowJson(serializeFlow(merged.nodes, merged.edges, 'architecture'))
    expect(restored.nodes[0].position.x).toBe(12.123456)
    expect(restored.nodes[0].data.description).toBe('Keep custom metadata')
  })

  it('keeps existing edge styling and unknown metadata when explicitly updating protocol/communication', () => {
    const chart = selectionEditChart(nodes, edges)
    const validated = validateSelectionEdit(chart.nodes, chart.edges, { ...scope, edgeIds: ['ab'] }, { summary: 'Publish events', operations: [{ op: 'update_edge', id: 'ab', changes: { protocol: 'event', commStyle: 'async', label: 'Order placed' } }] })
    if (!validated.ok) throw new Error(validated.error)
    const merged = mergeSelectionEditResult(nodes, edges, validated.result, deps)
    expect(merged.nodes[0]).toBe(nodes[0])
    expect(merged.edges[0]).toMatchObject({ id: 'ab', source: 'a', target: 'b', label: 'Order placed', animated: true, style: { stroke: '#bc1234', strokeWidth: 4, strokeDasharray: '5 5' }, data: { protocol: 'event', commStyle: 'async', custom: 123 }, markerEnd: edges[0].markerEnd })
  })

  it('summarizes additions, changes, removals and implicit affected connections for preview', () => {
    const chart = selectionEditChart(nodes, edges)
    const validated = validateSelectionEdit(chart.nodes, chart.edges, { ...scope, edgeIds: ['ab'] }, { summary: 'Replace selected service', operations: [{ op: 'remove_node', id: 'a' }, { op: 'add_node', node: { id: 'new', type: 'service', label: 'New API', position: { x: 100, y: 50 } } }] })
    if (!validated.ok) throw new Error(validated.error)
    const merged = mergeSelectionEditResult(nodes, edges, validated.result, deps)
    const preview = selectionEditPreview(nodes, edges, merged.nodes, merged.edges, validated.proposal.summary)
    expect(preview.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'node', id: 'a', action: 'removed' }),
      expect.objectContaining({ kind: 'node', id: 'new', action: 'added' }),
      expect.objectContaining({ kind: 'edge', id: 'ab', action: 'removed' }),
    ]))
    expect(merged.nodes.find(node => node.id === 'b')).toBe(nodes[1])
  })
})

describe('captured selection staleness', () => {
  it('ignores selection changes, measurement and unrelated edits without retargeting IDs', () => {
    const isolated = { id: 'c', type: 'step', position: { x: 900, y: 0 }, data: { label: 'Unrelated' } }
    const original = [...nodes, isolated], snapshot = captureSelectionEditSnapshot(original, edges, ['a'], 2)
    const changed = original.map(node => node.id === 'a' ? { ...node, selected: false, dragging: true, width: 500 } : node.id === 'c' ? { ...node, selected: true, data: { label: 'Unrelated renamed' } } : node)
    expect(selectionEditSnapshotIsCurrent(snapshot, changed, edges, 2)).toBe(true)
    expect(snapshot.nodeIds).toEqual(['a'])
    expect(authoredGraphSignature(nodes, edges)).toBe(authoredGraphSignature(nodes.map(node => ({ ...node, selected: !node.selected, dragging: true, width: 500 })), edges))
  })

  it('detects exact geometry changes smaller than export rounding, new incident edges and document replacement', () => {
    const snapshot = captureSelectionEditSnapshot(nodes, edges, ['a'], 2)
    const moved = nodes.map(node => node.id === 'a' ? { ...node, position: { ...node.position, x: node.position.x + 0.000001 } } : node)
    expect(selectionEditSnapshotIsCurrent(snapshot, moved, edges, 2)).toBe(false)
    expect(selectionEditSnapshotIsCurrent(snapshot, nodes, [...edges, { id: 'new-edge', source: 'b', target: 'a' }], 2)).toBe(false)
    expect(selectionEditSnapshotIsCurrent(snapshot, nodes, edges, 3)).toBe(false)
  })

  it('captures hierarchy dependencies and rejects empty or missing selections', () => {
    const parent = { id: 'p', type: 'container', position: { x: 0, y: 0 }, data: { label: 'Parent' } }
    const nested = [parent, { ...nodes[0], parentNode: 'p' }]
    const snapshot = captureSelectionEditSnapshot(nested, [], ['p'], 0)
    expect(selectionEditSnapshotIsCurrent(snapshot, nested.map(node => node.id === 'a' ? { ...node, data: { label: 'Child changed' } } : node), [], 0)).toBe(false)
    expect(() => captureSelectionEditSnapshot(nodes, edges, [], 0)).toThrow('Select at least')
    expect(() => captureSelectionEditSnapshot(nodes, edges, ['missing'], 0)).toThrow('Select at least')
  })

  it('captures recursive container descendants for API scope and staleness checks', () => {
    const nested: Node[] = [
      { id: 'outer', type: 'container', position: { x: 100, y: 50 }, data: { label: 'Outer' }, style: { width: 700, height: 500 } },
      { id: 'inner', type: 'container', parentNode: 'outer', position: { x: 20, y: 30 }, data: { label: 'Inner' }, style: { width: 400, height: 300 } },
      { ...nodes[0], parentNode: 'inner' },
    ]
    const snapshot = captureSelectionEditSnapshot(nested, [], ['outer'], 1)
    expect(snapshot.dependencyIds).toEqual(['a', 'inner', 'outer'])
    expect(selectionEditContext(nested, [], snapshot).nodes).toHaveLength(3)
    expect(selectionEditSnapshotIsCurrent(snapshot, nested.map(node => node.id === 'a' ? { ...node, position: { ...node.position, x: 99 } } : node), [], 1)).toBe(false)
    const chart = selectionEditChart(nested, [])
    const proposal = { summary: 'Move the outer box', operations: [{ op: 'update_node', id: 'outer', changes: { position: { x: 500, y: 50 } } }] }
    expect(validateSelectionEdit(chart.nodes, [], { ...scope, nodeIds: ['outer'] }, proposal).ok).toBe(false)
  })

  it('sends only nearby context and omits embedded image bytes while retaining metadata locally', () => {
    const image: Node = { id: 'image', type: 'image', position: { x: 0, y: 0 }, data: { label: 'Uploaded diagram', imageUrl: 'data:image/png;base64,' + 'x'.repeat(20000) }, selected: true }
    const unrelated: Node = { id: 'far', type: 'step', position: { x: 999, y: 999 }, data: { label: 'Far away' } }
    const snapshot = captureSelectionEditSnapshot([image, unrelated], [], ['image'], 0)
    expect(selectionEditContext([image, unrelated], [], snapshot).nodes).toEqual([expect.objectContaining({ id: 'image', label: 'Uploaded diagram' })])
    expect(JSON.stringify(selectionEditContext([image, unrelated], [], snapshot))).not.toContain('base64')
    expect(selectionEditChart([image], []).nodes[0].imageUrl).toBe(image.data.imageUrl)
  })
})
