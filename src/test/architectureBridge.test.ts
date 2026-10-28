import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { DrawElement } from '../utils/drawScene'

import { bridgeData, graphFromElements, mergeGraphElements } from '../utils/architectureBridge'

const node = (id: string, x: number, y: number, extra: Partial<Node> = {}): Node => ({ id, type: 'service', position: { x, y }, data: { label: id }, style: { width: 180, height: 90 }, ...extra })
const arrow = (id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge => ({ id, source, target, animated: false, data: { protocol: 'HTTPS', commStyle: 'sync' }, ...extra })
const semantic = (elements: readonly DrawElement[], id: string) => elements.find(e => bridgeData(e)?.id === id)!

describe('semantic graph/custom Draw bridge', () => {
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
    const freeform = { id: 'sketch', type: 'rectangle', x: -30, y: -40, width: 20, height: 20, angle: 0.6, strokeColor: '#f00', isDeleted: false } as DrawElement
    const changed = mergeGraphElements([...native, freeform], [node('api', 200, 50), nodes[1]], edges, false)
    expect(semantic(changed, 'request')).toMatchObject({ x: 290, y: 140, points: [[0, 0], [-200, 110]] })
    expect(changed.find(e => e.id === freeform.id)).toMatchObject(freeform)
  })

  it('keeps unrelated native records byte-for-byte when projecting a graph', () => {
    const note = { id: 'old-note', type: 'text', x: 15, y: 20, width: 100, height: 30, angle: 0, text: 'Keep me', customData: { owner: 'user' } } as DrawElement
    const shape = { id: 'sketch', type: 'rectangle', x: 0, y: 100, width: 100, height: 70, angle: 0, boundElements: [{ id: 'native-label', type: 'text' }] } as DrawElement
    const label = { id: 'native-label', type: 'text', x: 10, y: 110, width: 70, height: 30, angle: 0, text: 'Native', containerId: 'sketch' } as DrawElement
    const merged = mergeGraphElements([note, shape, label], [node('api', 300, 0)], [], false)
    expect(merged.slice(0, 3)).toEqual([note, shape, label])
    expect(merged[0]).toBe(note)
    expect(merged[1]).toBe(shape)
    expect(merged[2]).toBe(label)
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

  it('keeps vertical connector labels readable on creation, later addition and edits', () => {
    const nodes = [node('api', 0, 0), node('queue', 0, 250)]
    const edges = [arrow('order', 'api', 'queue', { label: 'Order placed', data: { protocol: 'event', commStyle: 'async' } })]
    const created = mergeGraphElements([], nodes, edges, false)
    const connector = semantic(created, 'order')
    const caption = created.find(element => element.type === 'text' && element.containerId === connector.id)!
    expect(connector.width).toBe(0)
    expect(caption.text).toBe('Order placed · event')
    expect(caption.width).toBeGreaterThan(120)
    expect(caption.width).toBeLessThanOrEqual(320)
    expect(caption.height).toBeLessThan(30)

    const editedEdges = [arrow('order', 'api', 'queue', { label: 'Order placed\nQueue notified', data: { protocol: 'event', commStyle: 'async' } })]
    const updated = mergeGraphElements(created, nodes, editedEdges, false)
    const editedCaption = updated.find(element => element.id === caption.id)!
    expect(editedCaption.text).toBe('Order placed\nQueue notified · event')
    expect(editedCaption.originalText).toBe(editedCaption.text)
    expect(editedCaption.height).toBeCloseTo(35)
    expect(semantic(updated, 'order').points).toEqual(connector.points)
    expect(semantic(updated, 'order').startBinding).toEqual(connector.startBinding)
    expect(semantic(updated, 'order').endBinding).toEqual(connector.endBinding)
    expect(graphFromElements(updated, nodes, editedEdges).edges[0]).toMatchObject({ label: 'Order placed\nQueue notified', data: { protocol: 'event', commStyle: 'async' } })

    const bare = mergeGraphElements([], nodes, [arrow('order', 'api', 'queue', { data: {} })], false)
    const added = mergeGraphElements(bare, nodes, edges, false)
    const addedCaption = added.find(element => element.type === 'text' && element.containerId === semantic(added, 'order').id)!
    expect(addedCaption.width).toBe(caption.width)
    expect(addedCaption.height).toBe(caption.height)
    expect(created.filter(element => element.type === 'text' && element.containerId !== connector.id).every(element => element.width <= 160)).toBe(true)
  })

  it('keeps a native custom path when only protocol/appearance metadata changes', () => {
    const nodes = [node('api', 0, 0), node('db', 0, 250)]
    const edges = [arrow('request', 'api', 'db')]
    const native = mergeGraphElements([], nodes, edges, false).map(e => e.type === 'arrow' ? { ...e, points: [[0, 0], [70, 40], [0, 160]] } as unknown as DrawElement : e)
    const changed = mergeGraphElements(native, nodes, [arrow('request', 'api', 'db', { data: { protocol: 'SQL', commStyle: 'async' } })], false)
    expect(semantic(changed, 'request')).toMatchObject({ points: [[0, 0], [70, 40], [0, 160]], strokeStyle: 'dashed' })
  })
  it('uses canonical colors in both themes and preserves a label equal to its protocol', () => {
    const nodes = [node('api', 0, 0), node('db', 300, 0)]
    const edges = [arrow('sql', 'api', 'db', { label: 'SQL', data: { protocol: 'SQL' } })]
    const dark = mergeGraphElements([], nodes, edges, true)
    expect(dark.find(e => bridgeData(e)?.kind === 'node')?.strokeColor).toBe('#087f5b')
    const edge = dark.find(e => bridgeData(e)?.kind === 'edge')!
    expect(dark.find(e => e.type === 'text' && e.containerId === edge.id)).toMatchObject({ text: 'SQL' })
    expect(graphFromElements(dark, nodes, edges).edges[0].label).toBe('SQL')
  })

})
