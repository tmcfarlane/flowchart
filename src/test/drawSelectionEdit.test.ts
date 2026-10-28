import { describe, expect, it } from 'vitest'
import { captureDrawEdit, applyDrawEdit, drawEditIsCurrent } from '../utils/drawSelectionEdit'
import { validateDrawEdit, DrawEditContextSchema } from '../shared/drawSelectionEdit'
import { createElement } from '../utils/drawScene'
import { mergeGraphElements, graphFromElements } from '../utils/architectureBridge'
import type { ArchitectureScene } from '../shared/architectureScene'
import type { Node } from 'reactflow'

const shape = (id = 'shape') => createElement('rectangle', { x: 10, y: 20 }, { x: 210, y: 120 }, { id, customData: { authored: { retain: true } } })
const scene = (): ArchitectureScene => ({ version: 1, elements: [shape(), shape('other')], files: {}, appState: { gridSize: 20 } })
const proposal = (changes: unknown, id = 'shape') => ({ summary: 'Update selection', operations: [{ op: 'update_element', id, changes }] })

describe('bounded Draw AI edits', () => {
  it('updates one standalone shape sparsely, preserving every other authored field and scene record', () => {
    const before = scene(), snapshot = captureDrawEdit(before, ['shape'], 7)
    const next = applyDrawEdit(before, snapshot, proposal({ x: 50, width: 240, angle: 0.2, backgroundColor: '#dbeafe' }), [], [])
    expect(next.elements[0]).toEqual({ ...before.elements[0], x: 50, width: 240, angle: 0.2, backgroundColor: '#dbeafe' })
    expect(next.elements[1]).toBe(before.elements[1])
    expect(next.files).toBe(before.files)
    expect(next.appState).toBe(before.appState)
    expect(before.elements[0].x).toBe(10)
    expect(JSON.stringify(snapshot.context)).not.toMatch(/customData|authored|files|appState/)
  })
  it.each([
    { link: 'https://example.com' }, { customData: {} }, { frameId: null }, { boundElements: [] }, { containerId: null }, { type: 'ellipse' }, { fileId: 'new-file' }, { points: [[0, 0]] },
    { x: Infinity }, { y: -1000001 }, { width: -1 }, { opacity: 101 }, { strokeColor: 'url(https://example.com)' }, { text: 'x'.repeat(2001) }, {},
  ])('rejects unsafe or unbounded fields: %o', changes => {
    expect(() => validateDrawEdit(captureDrawEdit(scene(), ['shape'], 1).context, proposal(changes))).toThrow()
  })
  it('rejects replacements, additions, deletions, duplicate operations and out-of-selection updates', () => {
    const context = captureDrawEdit(scene(), ['shape'], 1).context
    for (const input of [{ summary: '', elements: [] }, { summary: '', operations: [{ op: 'remove_element', id: 'shape' }] }, { summary: '', operations: [{ op: 'add_element', element: shape() }] }, proposal({ x: 5 }, 'other'), { ...proposal({ x: 5 }), operations: [proposal({ x: 5 }).operations[0], proposal({ y: 4 }).operations[0]] }]) expect(() => validateDrawEdit(context, input)).toThrow()
  })
  it('rejects locked, deleted, missing, unsupported and oversized selections before sending context', () => {
    for (const element of [{ ...shape(), locked: true }, { ...shape(), isDeleted: true }, { ...shape(), type: 'unsupported', fileId: 'private' }]) expect(() => captureDrawEdit({ ...scene(), elements: [element] }, ['shape'], 0)).toThrow()
    expect(() => captureDrawEdit(scene(), ['missing'], 0)).toThrow()
    expect(() => captureDrawEdit(scene(), [], 0)).toThrow()
    const many = Array.from({ length: 51 }, (_, index) => shape(`s${index}`))
    expect(() => captureDrawEdit({ ...scene(), elements: many }, many.map(element => element.id), 0)).toThrow()
  })
  it('rejects AI edits to a deep-selected label or child protected by its locked owner', () => {
    const host = { ...shape(), locked: true }
    const label = createElement('text', { x: 20, y: 40 }, undefined, { id: 'label', containerId: host.id, text: 'Original' })
    const frame = { ...shape('frame'), type: 'frame', locked: true }
    const child = { ...shape('child'), frameId: frame.id }
    const before = { ...scene(), elements: [host, label, frame, child] }
    expect(() => captureDrawEdit(before, ['label'], 0)).toThrow(/unlocked/)
    expect(() => captureDrawEdit(before, ['child'], 0)).toThrow(/unlocked/)
  })
  it('captures relationships without asset or private metadata and rejects geometry touching dependencies', () => {
    const host = shape(), label = createElement('text', { x: 20, y: 40 }, undefined, { id: 'label', containerId: host.id, text: 'Original' })
    host.boundElements = [{ id: label.id, type: 'text' }]
    const arrow = createElement('arrow', { x: 200, y: 80 }, { x: 400, y: 80 }, { id: 'arrow', startBinding: { elementId: host.id } })
    const before: ArchitectureScene = { ...scene(), elements: [host, label, arrow], files: {} }
    const snapshot = captureDrawEdit(before, ['shape', 'label'], 0)
    expect(snapshot.context.dependencies.map(item => item.id)).toContain('arrow')
    expect(() => applyDrawEdit(before, snapshot, proposal({ x: 60 }), [], [])).toThrow(/independent/)
    const next = applyDrawEdit(before, snapshot, proposal({ text: 'Orders' }, 'label'), [], [])
    expect(next.elements[1]).toEqual({ ...label, text: 'Orders', originalText: 'Orders', width: 73.2, height: 26, x: 73.4, y: 57 })
    expect(next.elements[0]).toBe(host)
    expect(next.elements[2]).toBe(arrow)
    expect(() => validateDrawEdit(captureDrawEdit(before, ['label'], 0).context, proposal({ text: 'Changed' }, 'label'))).toThrow(/host/)
  })
  it.each([false, true])('sizes long multiline text and preserves exact unrelated records (bound=%s)', bound => {
    const host = { ...shape(), angle: 0.35, boundElements: [{ id: 'label', type: 'text' }] }
    const label = createElement('text', { x: 40, y: 50 }, undefined, {
      id: 'label', width: 100, height: 25, text: 'Old', originalText: 'Old', fontSize: 28, fontFamily: 3,
      angle: 0.35, lineHeight: 1.8, containerId: bound ? host.id : null, textAlign: 'center', verticalAlign: 'middle',
      customData: { private: 'retained' },
    })
    const unrelated = { ...shape('other'), boundElements: [{ id: 'shape', type: 'custom' }] }
    const before: ArchitectureScene = { ...scene(), elements: [host, label, unrelated] }
    const text = 'Review incoming customer orders and validate each delivery address before sending the confirmation.\nReserve inventory.\nDispatch the shipment.'
    const next = applyDrawEdit(before, captureDrawEdit(before, bound ? ['shape', 'label'] : ['label'], 0), proposal({ text }, 'label'), [], [])
    const width = text.split('\n')[0].length * 28 * 0.61, height = 3 * 28 * 1.8
    expect(next.elements[1]).toEqual({ ...label, text, originalText: text, width, height,
      ...(bound ? { x: host.x + host.width / 2 - width / 2, y: host.y + host.height / 2 - height / 2 } : {}),
    })
    expect(next.elements[0]).toBe(host)
    expect(next.elements[2]).toBe(unrelated)
    expect(next.files).toBe(before.files)
    expect(next.appState).toBe(before.appState)
    expect(label.text).toBe('Old')
  })
  it('preserves text metrics for appearance-only updates and rejects model-authored text geometry', () => {
    const label = createElement('text', { x: 10, y: 20 }, undefined, { id: 'label', text: 'Old', width: 60, height: 27 })
    const before = { ...scene(), elements: [label] }, snapshot = captureDrawEdit(before, ['label'], 0)
    expect(applyDrawEdit(before, snapshot, proposal({ strokeColor: '#2563eb' }, 'label'), [], []).elements[0]).toEqual({ ...label, strokeColor: '#2563eb' })
    expect(() => applyDrawEdit(before, snapshot, proposal({ text: 'New', width: 200 }, 'label'), [], [])).toThrow(/independent/)
  })
  it('permits projected labels and appearance while preserving semantic IDs and geometry', () => {
    const nodes: Node[] = [{ id: 'api', type: 'service', position: { x: 10, y: 20 }, style: { width: 200, height: 100 }, data: { label: 'Old API', custom: 'keep' } }]
    const elements = mergeGraphElements([], nodes, [], false), before: ArchitectureScene = { version: 1, elements, files: {} }
    const host = elements.find(element => element.type === 'rectangle')!, label = elements.find(element => element.type === 'text')!
    const snapshot = captureDrawEdit(before, [host.id, label.id], 0)
    expect(() => applyDrawEdit(before, snapshot, proposal({ width: 300 }, host.id), nodes, [])).toThrow(/independent/)
    const next = applyDrawEdit(before, snapshot, proposal({ text: 'Orders API' }, label.id), nodes, [])
    const graph = graphFromElements(next.elements as typeof elements, nodes, [])
    expect(graph.nodes[0]).toMatchObject({ id: 'api', position: nodes[0].position, style: nodes[0].style, data: { label: 'Orders API', custom: 'keep' } })
  })
  it.each(['arrow', 'freedraw', 'image', 'frame'])('allows only safe appearance for selected %s and preserves its private geometry and assets', type => {
    const target = createElement(type, { x: 30, y: 40 }, { x: 250, y: 190 }, {
      id: 'native', points: [[0, 0], [50, 150], [220, 150]], pressures: [0.2, 0.8, 0.4],
      startBinding: { elementId: 'shape', focus: 0.3 }, fileId: 'private-image',
      customData: { secret: 'private-value' }, link: 'https://private.example/path',
    })
    const before: ArchitectureScene = { ...scene(), elements: [shape(), target], files: { 'private-image': { id: 'private-image', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } } }
    const snapshot = captureDrawEdit(before, ['native'], 0)
    expect(snapshot.context.targets[0]).toMatchObject({ type, geometryAllowed: false, textAllowed: false })
    expect(JSON.stringify(snapshot.context)).not.toMatch(/points|pressures|fileId|dataURL|private-value|private.example/)
    const next = applyDrawEdit(before, snapshot, proposal({ opacity: 65, strokeColor: '#2563eb' }, 'native'), [], [])
    expect(next.elements).toEqual([before.elements[0], { ...target, opacity: 65, strokeColor: '#2563eb' }])
    expect(next.files).toBe(before.files)
    for (const changes of [{ x: 80 }, { text: 'Unsafe' }, { points: [[1, 1]] }, { fileId: 'other' }]) expect(() => applyDrawEdit(before, snapshot, proposal(changes, 'native'), [], [])).toThrow()
  })
  it('renames a selected arrow label at its path midpoint without changing its host or bindings', () => {
    const host = createElement('arrow', { x: 10, y: 20 }, { x: 210, y: 120 }, {
      id: 'arrow', points: [[0, 0], [0, 100], [200, 100]], startBinding: { elementId: 'shape', gap: 4 },
      boundElements: [{ id: 'label', type: 'text' }], pressures: [0.2, 0.4, 0.8],
    })
    const label = createElement('text', { x: 20, y: 30 }, undefined, { id: 'label', containerId: host.id, text: 'Old', angle: 0.2 })
    const before: ArchitectureScene = { ...scene(), elements: [shape(), host, label] }
    const next = applyDrawEdit(before, captureDrawEdit(before, ['arrow', 'label'], 0), proposal({ text: 'Updated connector' }, 'label'), [], [])
    const edited = next.elements[2]
    expect(Number(edited.x) + Number(edited.width) / 2).toBeCloseTo(60)
    expect(Number(edited.y) + Number(edited.height) / 2).toBeCloseTo(120)
    expect(edited.angle).toBe(label.angle)
    expect(next.elements[0]).toBe(before.elements[0])
    expect(next.elements[1]).toBe(host)
    expect(next.files).toBe(before.files)
    expect(() => applyDrawEdit(before, captureDrawEdit(before, ['label'], 0), proposal({ text: 'No host' }, 'label'), [], [])).toThrow(/host/)
  })
  it('freezes exact scene, selection and epoch, including files and unselected metadata', () => {
    const before = scene(), snapshot = captureDrawEdit(before, ['shape'], 10)
    expect(drawEditIsCurrent(snapshot, before, ['shape'], 10)).toBe(true)
    expect(drawEditIsCurrent(snapshot, before, ['shape'], 11)).toBe(false)
    expect(drawEditIsCurrent(snapshot, before, ['other'], 10)).toBe(false)
    const changed = { ...before, elements: before.elements.map(element => element.id === 'other' ? { ...element, locked: true } : element) }
    expect(drawEditIsCurrent(snapshot, changed, ['shape'], 10)).toBe(false)
    expect(() => applyDrawEdit(changed, snapshot, proposal({ x: 50 }), [], [])).toThrow(/changed/)
  })
  it('rejects context fields and missing dependency records', () => {
    const context = captureDrawEdit(scene(), ['shape'], 0).context
    expect(DrawEditContextSchema.safeParse({ ...context, files: {} }).success).toBe(false)
    expect(DrawEditContextSchema.safeParse({ ...context, targets: [{ ...context.targets[0], dependencyIds: ['missing'] }] }).success).toBe(false)
  })
})
