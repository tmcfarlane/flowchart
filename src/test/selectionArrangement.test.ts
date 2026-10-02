import { describe, expect, it, vi } from 'vitest'
import type { Node } from 'reactflow'
import { LIMITS } from '../shared/flowTypes'
import { arrangeSelectedNodes, getSelectionArrangementAvailability, type SelectionArrangeAction } from '../utils/selectionArrangement'

const node = (id: string, x: number, y: number, width = 100, height = 60, extra: Partial<Node> = {}): Node => ({
  id, type: 'service', position: { x, y }, width, height, selected: true, data: { label: id }, ...extra,
})

describe('selected sibling arrangement', () => {
  it.each<[{ action: SelectionArrangeAction; a: [number, number]; b: [number, number] }]>([
    [{ action: 'align-left', a: [10, 20], b: [10, 170] }],
    [{ action: 'align-center', a: [155, 20], b: [205, 170] }],
    [{ action: 'align-right', a: [300, 20], b: [400, 170] }],
    [{ action: 'align-top', a: [10, 20], b: [400, 20] }],
    [{ action: 'align-middle', a: [10, 115], b: [400, 95] }],
    [{ action: 'align-bottom', a: [10, 210], b: [400, 170] }],
  ])('aligns $action to actual selection bounds with uneven sizes', ({ action, a, b }) => {
    const input = [node('a', 10, 20, 200, 60), node('b', 400, 170, 100, 100)]
    const result = arrangeSelectedNodes(input, action)
    expect(result.error).toBeUndefined()
    expect(result.changed).toBe(true)
    expect(result.nodes.map((n) => [n.position.x, n.position.y])).toEqual([a, b])
    expect(input.map((n) => n.position)).toEqual([{ x: 10, y: 20 }, { x: 400, y: 170 }])
  })

  it('distributes equal horizontal gaps, preserves anchors and document order', () => {
    const input = [node('middle-2', 300, 110, 80), node('last', 800, 90, 150), node('first', 20, 10, 100), node('middle-1', 170, 70, 200)]
    const result = arrangeSelectedNodes(input, 'distribute-horizontal')
    const gap = (800 - 20 - 100 - 200 - 80) / 3
    expect(result.nodes.map((n) => n.id)).toEqual(input.map((n) => n.id))
    expect(result.nodes[0].position.x).toBeCloseTo(20 + 100 + gap + 200 + gap)
    expect(result.nodes[3].position.x).toBeCloseTo(20 + 100 + gap)
    expect(result.nodes[0].position.y).toBe(110)
    expect(result.nodes[3].position.y).toBe(70)
    expect(result.nodes[1]).toBe(input[1])
    expect(result.nodes[2]).toBe(input[2])
  })

  it('distributes equal vertical gaps with uneven heights', () => {
    const input = [node('first', 10, 15, 100, 40), node('middle', 55, 130, 100, 100), node('last', 75, 455, 100, 80)]
    const result = arrangeSelectedNodes(input, 'distribute-vertical')
    expect(result.nodes[1].position).toEqual({ x: 55, y: 205 })
    expect(result.nodes[0]).toBe(input[0])
    expect(result.nodes[2]).toBe(input[2])
  })

  it('keeps coordinate ties deterministic and allows zero gaps', () => {
    const input = [node('a', 10, 0, 50), node('b', 10, 70, 50), node('c', 110, 140, 50)]
    const result = arrangeSelectedNodes(input, 'distribute-horizontal')
    expect(result.nodes.map((n) => n.position.x)).toEqual([10, 60, 110])
    expect(result.nodes[0]).toBe(input[0])
    expect(result.nodes[2]).toBe(input[2])
  })

  it.each(['distribute-horizontal', 'distribute-vertical'] as const)('refuses negative gaps for %s without changing the original array', (action) => {
    const input = [node('a', 0, 0, 150, 150), node('b', 20, 20, 200, 200), node('c', 100, 100, 150, 150)]
    const result = arrangeSelectedNodes(input, action)
    expect(result.nodes).toBe(input)
    expect(result.changed).toBe(false)
    expect(result.error).toMatch(/farther apart.*without overlap/)
    const availability = getSelectionArrangementAvailability(input)
    expect(availability.align.enabled).toBe(true)
    expect(availability.horizontal.enabled).toBe(false)
    expect(availability.vertical.enabled).toBe(false)
  })

  it('moves sibling positions relative to their parent while preserving metadata and artwork', () => {
    const callback = vi.fn()
    const data = { label: ' ', icon: 'icon-robot', imageUrl: 'data:image/avif;base64,AA==', onDelete: callback, custom: { nested: true } }
    const style = { width: 100, height: 60, color: 'purple' }
    const parent = node('vpc', 700, 500, 700, 500, { type: 'container', selected: false })
    const a = node('a', 20, 30, 100, 60, { parentNode: 'vpc', extent: 'parent', data, style })
    const b = node('b', 350, 90, 80, 90, { parentNode: 'vpc', extent: 'parent', type: 'image', draggable: false })
    const unselected = node('unselected', 50, 350, 100, 60, { parentNode: 'vpc', selected: false })
    const input = [parent, a, b, unselected]
    const result = arrangeSelectedNodes(input, 'align-right')
    expect(result.nodes[1].position).toEqual({ x: 330, y: 30 })
    expect(result.nodes[1].data).toBe(data)
    expect(result.nodes[1].style).toBe(style)
    expect(result.nodes[1].parentNode).toBe('vpc')
    expect(result.nodes[1].extent).toBe('parent')
    expect(result.nodes[1].width).toBe(a.width)
    expect(result.nodes[2]).toBe(b)
    expect(result.nodes[0]).toBe(parent)
    expect(result.nodes[3]).toBe(unselected)
    expect(callback).not.toHaveBeenCalled()
    expect(a.position).toEqual({ x: 20, y: 30 })
  })

  it('allows selected sibling containers without changing their unselected children', () => {
    const input = [node('a', 0, 10, 400, 300, { type: 'container' }), node('child', 20, 20, 100, 60, { parentNode: 'a', extent: 'parent', selected: false }), node('b', 600, 80, 400, 300, { type: 'container' })]
    const result = arrangeSelectedNodes(input, 'align-top')
    expect(result.changed).toBe(true)
    expect(result.nodes[1]).toBe(input[1])
    expect(result.nodes[2].position).toEqual({ x: 600, y: 10 })
  })

  it('rejects selection of an ancestor and nested descendant before filtering any subset', () => {
    const input = [node('a', 0, 0, 700, 500, { type: 'container' }), node('b', 20, 20, 400, 300, { parentNode: 'a', type: 'container', selected: false }), node('c', 10, 10, 100, 60, { parentNode: 'b' }), node('peer', 200, 10, 100, 60, { parentNode: 'b' })]
    const result = arrangeSelectedNodes(input, 'align-left')
    expect(result.nodes).toBe(input)
    expect(result.error).toMatch(/ancestor/)
  })

  it('rejects mixed parents with a useful selection reason', () => {
    const input = [node('parent', 0, 0, 500, 400, { type: 'container', selected: false }), node('child', 10, 10, 100, 60, { parentNode: 'parent' }), node('root', 700, 10)]
    expect(arrangeSelectedNodes(input, 'align-left')).toMatchObject({ nodes: input, changed: false, error: expect.stringMatching(/same container/) })
    expect(getSelectionArrangementAvailability(input).align.reason).toMatch(/same container/)
  })

  it.each([0, 1])('requires two selected nodes, with %i selected', (count) => {
    const input = [node('a', 0, 0, 100, 60, { selected: count > 0 }), node('b', 300, 100, 100, 60, { selected: false })]
    const result = arrangeSelectedNodes(input, 'align-top')
    expect(result.nodes).toBe(input)
    expect(result.error).toMatch(/at least two/)
    expect(arrangeSelectedNodes(input, 'distribute-horizontal').error).toMatch(/at least three/)
    expect(getSelectionArrangementAvailability(input).horizontal.reason).toMatch(/at least three/)
  })

  it('allows alignment of two siblings but explains why distribution needs three', () => {
    const input = [node('a', 0, 0), node('b', 300, 100)]
    expect(getSelectionArrangementAvailability(input)).toMatchObject({ align: { enabled: true }, horizontal: { enabled: false, reason: expect.stringMatching(/at least three/) }, vertical: { enabled: false } })
    expect(arrangeSelectedNodes(input, 'distribute-horizontal').nodes).toBe(input)
  })

  it('uses measured dimensions before numeric style, then supplied per-axis fallback', () => {
    const fallback = vi.fn(() => ({ width: 160, height: 90 }))
    const input = [node('a', 0, 0, 100, 60, { style: { width: 300, height: 300 } }), node('b', 300, 200, 100, 60, { width: undefined, height: undefined, style: { width: 200 } })]
    const result = arrangeSelectedNodes(input, 'align-center', { getNodeDimensions: fallback })
    expect(result.nodes.map((n) => n.position.x)).toEqual([200, 150])
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledWith(input[1])
    const vertical = arrangeSelectedNodes(input, 'align-bottom', { getNodeDimensions: fallback })
    expect(vertical.nodes[0].position.y).toBe(230)
  })

  it('falls back to existing type defaults when nodes have not been measured', () => {
    const input = [node('a', 0, 0, 100, 60, { width: undefined, height: null, type: 'decision' }), node('b', 300, 100, 100, 60, { width: undefined, height: null, type: 'image' })]
    expect(arrangeSelectedNodes(input, 'align-right').nodes[0].position.x).toBe(280)
    expect(arrangeSelectedNodes(input, 'align-middle').nodes.map((n) => n.position.y)).toEqual([40, 50])
  })

  it.each([NaN, Infinity, -1, 0, LIMITS.maxNodeSize + 1])('rejects invalid measured dimensions (%s), preserving inputs', (width) => {
    const input = [node('a', 0, 0, width), node('b', 300, 100)]
    const result = arrangeSelectedNodes(input, 'align-left')
    expect(result.nodes).toBe(input)
    expect(result.error).toMatch(/valid dimensions/)
  })

  it.each([NaN, Infinity, LIMITS.maxCoordinate + 1])('rejects invalid coordinates (%s)', (x) => {
    const input = [node('a', x, 0), node('b', 300, 100)]
    expect(arrangeSelectedNodes(input, 'align-left')).toMatchObject({ nodes: input, changed: false, error: expect.stringMatching(/finite positions/) })
  })

  it('refuses an alignment that would cross the finite coordinate limit', () => {
    const input = [node('a', LIMITS.maxCoordinate, 0, 500), node('b', LIMITS.maxCoordinate - 300, 100, 20)]
    const result = arrangeSelectedNodes(input, 'align-right')
    expect(result.nodes).toBe(input)
    expect(result.error).toMatch(/coordinate limit/)
  })

  it('refuses out-of-parent selection instead of relying on later ReactFlow clamping', () => {
    const input = [node('parent', 900, 900, 400, 300, { type: 'container', selected: false }), node('a', 20, 30, 100, 60, { parentNode: 'parent', extent: 'parent' }), node('b', 350, 90, 100, 90, { parentNode: 'parent', extent: 'parent' })]
    expect(arrangeSelectedNodes(input, 'align-left')).toMatchObject({ nodes: input, changed: false, error: expect.stringMatching(/resize the container/) })
  })

  it('rejects missing parents, hierarchy cycles and ambiguous duplicate ids', () => {
    const missing = [node('a', 0, 0, 100, 60, { parentNode: 'missing' }), node('b', 300, 0, 100, 60, { parentNode: 'missing' })]
    expect(arrangeSelectedNodes(missing, 'align-left').error).toMatch(/missing container/)
    const cycle = [node('a', 0, 0, 400, 300, { type: 'container', parentNode: 'b', selected: false }), node('b', 0, 0, 400, 300, { type: 'container', parentNode: 'a', selected: false }), node('child', 0, 0, 100, 60, { parentNode: 'a' }), node('child2', 200, 0, 100, 60, { parentNode: 'a' })]
    expect(arrangeSelectedNodes(cycle, 'align-left').error).toMatch(/cycle/)
    expect(arrangeSelectedNodes([node('same', 0, 0), node('same', 300, 100)], 'align-left').error).toMatch(/duplicate/)
  })

  it('returns the original array for an already aligned or distributed selection', () => {
    const input = [node('a', 0, 0), node('b', 200, 0), node('c', 400, 0)]
    expect(arrangeSelectedNodes(input, 'align-top')).toEqual({ nodes: input, changed: false })
    expect(arrangeSelectedNodes(input, 'align-top').nodes).toBe(input)
    expect(arrangeSelectedNodes(input, 'distribute-horizontal').nodes).toBe(input)
  })

  it('operates on frozen inputs without mutating artwork or position objects', () => {
    const input = [node('a', -400, -100, 100, 60), node('b', -50, 80, 100, 60)]
    input.forEach((n) => { Object.freeze(n.position); Object.freeze(n.data); Object.freeze(n) })
    Object.freeze(input)
    const result = arrangeSelectedNodes(input, 'align-left')
    expect(result.nodes[1].position.x).toBe(-400)
    expect(result.nodes[1].data).toBe(input[1].data)
    expect(input[1].position.x).toBe(-50)
  })
})
