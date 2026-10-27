import { describe, expect, it, vi } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'

// The bridge owns graph relationships and reconciliation. Native text metrics
// and rendering require a real canvas and are covered by browser verification.
vi.mock('@excalidraw/excalidraw', () => ({
  newElementWith: (element: Record<string, unknown>, changes: Record<string, unknown>) => ({ ...element, ...changes }),
  convertToExcalidrawElements: (skeletons: Array<Record<string, unknown>>) => skeletons.flatMap((skeleton, i) => {
    const element = { angle: 0, width: 100, height: 60, isDeleted: false, ...skeleton, id: skeleton.id ?? `generated-${i}-${String(skeleton.text)}` }
    const label = skeleton.label as { text: string } | undefined
    if (!label?.text) return [element]
    const text = { id: `${element.id}-label`, type: 'text', x: element.x, y: element.y, width: 80, height: 20, angle: 0, text: label.text, originalText: label.text, containerId: element.id, isDeleted: false }
    return [{ ...element, boundElements: [{ id: text.id, type: 'text' }] }, text]
  }),
}))

import { bridgeData, graphFromElements, mergeGraphElements } from '../utils/architectureBridge'

const node = (id: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({ id, type: 'service', position: { x, y }, data: { label: id }, style: { width: 180, height: 90 }, ...extra })
const arrow = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id, source, target, animated: false, data: { protocol: 'HTTPS', commStyle: 'sync' }, ...extra })
const semantic = (elements: readonly ExcalidrawElement[], id: string) => elements.find(e => bridgeData(e)?.id === id)!

describe('semantic graph/native drawing bridge', () => {
  it('keeps container labels and child-relative positions through the initial conversion', () => {
    const nodes = [node('boundary', 100, -50, { type: 'container', data: { label: 'Private network', containerKind: 'vpc' }, style: { width: 500, height: 300 } }), node('api', 40, 60, { parentNode: 'boundary' })]
    const native = mergeGraphElements([], nodes, [], false)
    const roundTrip = graphFromElements(native, nodes, [])
    expect(roundTrip.nodes.find(n => n.id === 'boundary')?.data.label).toBe('Private network')
    expect(roundTrip.nodes.find(n => n.id === 'api')).toMatchObject({ parentNode: 'boundary', position: { x: 40, y: 60 } })
  })

  it('detaches surviving children at absolute positions when their semantic container is deleted', () => {
    const nodes = [node('boundary', -100, 200, { type: 'container' }), node('api', 40, 60, { parentNode: 'boundary', extent: 'parent' })]
    const native = mergeGraphElements([], nodes, [], false).map(e => bridgeData(e)?.id === 'boundary' ? { ...e, isDeleted: true } : e)
    const result = graphFromElements(native, nodes, [])
    expect(result.nodes.map(n => n.id)).toEqual(['api'])
    expect(result.nodes[0]).toMatchObject({ position: { x: -60, y: 260 } })
    expect(result.nodes[0].parentNode).toBeUndefined()
    expect(result.nodes[0].extent).toBeUndefined()
  })

  it('gives semantic containers and descendants nested movement groups without replacing user groups', () => {
    const nodes = [node('vpc', 0, 0, { type: 'container' }), node('cluster', 10, 10, { type: 'container', parentNode: 'vpc' }), node('api', 20, 30, { parentNode: 'cluster' }), node('db', 250, 30, { parentNode: 'cluster' }), node('outside', 700, 0)]
    const edges = [arrow('internal', 'api', 'db'), arrow('external', 'api', 'outside')]
    const native = mergeGraphElements([], nodes, edges, false)
    expect(semantic(native, 'vpc').groupIds).toEqual(['fc-container-vpc'])
    expect(semantic(native, 'cluster').groupIds).toEqual(['fc-container-cluster', 'fc-container-vpc'])
    expect(semantic(native, 'api').groupIds).toEqual(['fc-container-cluster', 'fc-container-vpc'])
    expect(semantic(native, 'internal').groupIds).toEqual(['fc-container-cluster', 'fc-container-vpc'])
    expect(semantic(native, 'external').groupIds).toEqual([])
    const withUserGroup = native.map(element => bridgeData(element)?.id === 'api' ? { ...element, groupIds: ['user-group', ...element.groupIds] } : element)
    const detachedNodes = nodes.map(n => n.id === 'api' ? { ...n, parentNode: undefined } : n)
    const detached = mergeGraphElements(withUserGroup, detachedNodes, edges, false)
    expect(semantic(detached, 'api').groupIds).toEqual(['user-group'])
    expect(semantic(detached, 'internal').groupIds).toEqual([])
  })

  it('creates reciprocal native arrow bindings and honors graph endpoint handles', () => {
    const nodes = [node('api', 0, 0), node('db', 400, 200)]
    const native = mergeGraphElements([], nodes, [arrow('request', 'api', 'db', { sourceHandle: 'right', targetHandle: 'left' })], false)
    const edge = semantic(native, 'request')
    expect(edge).toMatchObject({ type: 'arrow', x: 180, y: 45, startBinding: { elementId: semantic(native, 'api').id }, endBinding: { elementId: semantic(native, 'db').id }, points: [[0, 0], [220, 200]] })
    expect(semantic(native, 'api').boundElements).toContainEqual({ id: edge.id, type: 'arrow' })
    expect(semantic(native, 'db').boundElements).toContainEqual({ id: edge.id, type: 'arrow' })
  })

  it('applies remote endpoint/protocol/style edits without writing old bindings back into the graph', () => {
    const nodes = [node('api', 0, 0), node('old', 0, 250), node('new', 500, 250)]
    const original = [arrow('request', 'api', 'old')]
    const native = mergeGraphElements([], nodes, original, false)
    const edited = [arrow('request', 'api', 'new', { label: 'publish', data: { protocol: 'event', commStyle: 'async' } })]
    const updated = mergeGraphElements(native, nodes, edited, false)
    const edge = semantic(updated, 'request')
    expect(edge).toMatchObject({ strokeStyle: 'dashed', endBinding: { elementId: semantic(updated, 'new').id } })
    expect(semantic(updated, 'old').boundElements ?? []).not.toContainEqual({ id: edge.id, type: 'arrow' })
    expect(graphFromElements(updated, nodes, edited).edges[0]).toMatchObject({ source: 'api', target: 'new', label: 'publish', data: { protocol: 'event', commStyle: 'async' } })
  })

  it('reroutes attached arrows after external graph moves while retaining unrelated freeform elements', () => {
    const nodes = [node('api', 0, 0), node('db', 0, 250)]
    const edges = [arrow('request', 'api', 'db')]
    const native = mergeGraphElements([], nodes, edges, false)
    const freeform = { id: 'sketch', type: 'rectangle', x: -30, y: -40, width: 20, height: 20, angle: 0.6, strokeColor: '#f00', isDeleted: false } as ExcalidrawElement
    const changed = mergeGraphElements([...native, freeform], [node('api', 200, 50), nodes[1]], edges, false)
    expect(semantic(changed, 'request')).toMatchObject({ x: 290, y: 140, points: [[0, 0], [-200, 110]] })
    expect(changed.find(e => e.id === freeform.id)).toMatchObject(freeform)
  })

  it('adds and removes bound edge labels on graph edits', () => {
    const nodes = [node('api', 0, 0), node('db', 0, 250)]
    const bare = [arrow('request', 'api', 'db', { data: {} })]
    const native = mergeGraphElements([], nodes, bare, false)
    const labeled = [arrow('request', 'api', 'db', { label: 'read', data: {} })]
    const added = mergeGraphElements(native, nodes, labeled, false)
    const edge = semantic(added, 'request')
    expect(added.find(e => e.type === 'text' && e.containerId === edge.id)).toMatchObject({ text: 'read', isDeleted: false })
    const removed = mergeGraphElements(added, nodes, bare, false)
    expect(removed.filter(e => e.type === 'text' && e.containerId === edge.id && !e.isDeleted)).toHaveLength(0)
    expect(graphFromElements(removed, nodes, bare).edges[0].label).toBeUndefined()
  })

  it('keeps a native custom path when only protocol/appearance metadata changes', () => {
    const nodes = [node('api', 0, 0), node('db', 0, 250)]
    const edges = [arrow('request', 'api', 'db')]
    const native = mergeGraphElements([], nodes, edges, false).map(e => e.type === 'arrow' ? { ...e, points: [[0, 0], [70, 40], [0, 160]] } as unknown as ExcalidrawElement : e)
    const changed = mergeGraphElements(native, nodes, [arrow('request', 'api', 'db', { data: { protocol: 'SQL', commStyle: 'async' } })], false)
    expect(semantic(changed, 'request')).toMatchObject({ points: [[0, 0], [70, 40], [0, 160]], strokeStyle: 'dashed' })
  })
})
