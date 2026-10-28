import { describe, expect, it } from 'vitest'
import type { ArchitectureScene } from '../shared/architectureScene'
import { createConnectedShape, flipSelection, lassoSelection, navigateConnection } from '../utils/drawGeometry'
import { createElement, getElementBounds, getElementCenter, getSceneBounds, getWorldPoints, rerouteBindings, rotatePoint, sceneElements, type DrawElement } from '../utils/drawScene'

const scene = (...elements: DrawElement[]): ArchitectureScene => ({ version: 1, elements, files: {}, appState: { gridSize: 20 } })
const box = (id: string, x = 0, y = 0) => createElement('rectangle', { x, y }, { x: x + 100, y: y + 60 }, { id })
const polygon = (x: number, y: number, w: number, h: number) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]

describe('Draw geometry', () => {
  it.each(['horizontal', 'vertical'] as const)('reflects rotated negative path coordinates and preserves pressures (%s)', axis => {
    const path = createElement('freedraw', { x: 120, y: 80 }, undefined, { id: 'path', angle: 0.73, width: 80, height: 80, points: [[0, 0], [-50, 60], [30, -20]], pressures: [0.2, 0.7, 0.4] })
    const original = scene(path), serialized = JSON.stringify(original), bounds = getSceneBounds(original.elements)
    const flipped = sceneElements(flipSelection(original, ['path'], axis))[0]
    getWorldPoints(flipped).forEach((point, index) => {
      const old = getWorldPoints(path)[index]
      expect(point.x).toBeCloseTo(axis === 'horizontal' ? 2 * bounds.x + bounds.width - old.x : old.x)
      expect(point.y).toBeCloseTo(axis === 'vertical' ? 2 * bounds.y + bounds.height - old.y : old.y)
    })
    expect(flipped.pressures).toEqual(path.pressures)
    expect([flipped.width, flipped.height]).toEqual([path.width, path.height])
    const rendered = getElementBounds(flipped), authored = getElementBounds(path)
    expect(rendered.x).toBeCloseTo(authored.x)
    expect(rendered.y).toBeCloseTo(authored.y)
    expect(rendered.width).toBeCloseTo(authored.width)
    expect(rendered.height).toBeCloseTo(authored.height)
    expect(JSON.stringify(original)).toBe(serialized)
  })
  it.each([false, true])('leaves a deep-selected bound label in place when its host is outside the flip (locked: %s)', locked => {
    const host = { ...box('host'), locked }
    const label = createElement('text', { x: 10, y: 10 }, undefined, { id: 'label', width: 40, height: 20, containerId: host.id, text: 'Label' })
    const original = scene(host, label)
    for (const axis of ['horizontal', 'vertical'] as const) {
      expect(flipSelection(original, ['label'], axis)).toBe(original)
      if (locked) expect(flipSelection(original, ['host', 'label'], axis)).toBe(original)
    }
  })
  it('flips image pixels and fixed binding anchors while keeping locked records byte-for-byte', () => {
    const shape = { ...box('shape'), angle: 0.3 }, locked = { ...box('locked', 400), locked: true }
    const image = createElement('image', { x: 150, y: 0 }, { x: 250, y: 60 }, { id: 'image', scale: [1, -1], fileId: 'asset' })
    const arrow = createElement('arrow', { x: 100, y: 30 }, { x: 400, y: 30 }, { id: 'arrow', startBinding: { elementId: 'shape', fixedPoint: [1, 0.5] }, endBinding: { elementId: 'locked', fixedPoint: [0, 0.5] } })
    const original = scene(shape, locked, image, arrow), next = sceneElements(flipSelection(original, ['shape', 'image'], 'horizontal'))
    expect(next[1]).toBe(locked)
    expect(next[2].scale).toEqual([-1, -1])
    expect(next[3].startBinding?.fixedPoint).toEqual([0, 0.5])
    expect(next[3].endBinding?.fixedPoint).toEqual([0, 0.5])
    const expectedStart = rotatePoint({ x: next[0].x, y: next[0].y + next[0].height / 2 }, getElementCenter(next[0]), next[0].angle ?? 0)
    expect(getWorldPoints(next[3])[0].x).toBeCloseTo(expectedStart.x)
    expect(getWorldPoints(next[3])[0].y).toBeCloseTo(expectedStart.y)
    expect(getWorldPoints(next[3]).at(-1)).toEqual({ x: 400, y: 30 })
    expect(sceneElements(flipSelection(original, ['locked'], 'vertical'))).toEqual(original.elements)
  })
  it('keeps bound labels readable and selected arrow endpoints attached to external shapes', () => {
    const a = box('a'), b = box('b', 300), label = createElement('text', { x: 20, y: 20 }, undefined, { id: 'label', containerId: 'a', text: 'Readable' })
    const arrow = createElement('arrow', { x: 100, y: 30 }, { x: 300, y: 30 }, { id: 'arrow', startBinding: { elementId: 'a', fixedPoint: [1, 0.5] }, endBinding: { elementId: 'b', fixedPoint: [0, 0.5] } })
    const next = sceneElements(flipSelection(scene(a, b, label, arrow), ['a', 'arrow'], 'vertical'))
    expect(next[2].text).toBe('Readable'); expect(next[2].angle).toBeCloseTo(0)
    expect(next[3].endBinding?.elementId).toBe('b')
    expect(next[3].startBinding?.fixedPoint).toEqual([1, 0.5])
    expect(next[3].endBinding?.fixedPoint).toEqual([0, 0.5])
    const start = rotatePoint({ x: next[0].x + next[0].width, y: next[0].y + next[0].height / 2 }, getElementCenter(next[0]), next[0].angle ?? 0)
    expect(getWorldPoints(next[3])[0].x).toBeCloseTo(start.x)
    expect(getWorldPoints(next[3])[0].y).toBeCloseTo(start.y)
    expect(getWorldPoints(next[3]).at(-1)).toEqual({ x: 300, y: 30 })
  })
  it('creates only a fresh shape, label and bound arrow, with no semantic metadata or incident edges', () => {
    const source = { ...box('source'), customData: { flowchart: { id: 'semantic', kind: 'node' } }, groupIds: ['group'], frameId: 'frame' }
    const label = createElement('text', { x: 20, y: 20 }, undefined, { id: 'label', containerId: 'source', text: 'Work', customData: { flowchart: {} } })
    const original = scene(source, label, box('unrelated', 800)), snapshot = JSON.stringify(original)
    const result = createConnectedShape(original, ['source', 'label'], 'ArrowRight')!
    const [clone, clonedLabel, arrow] = sceneElements(result.scene).slice(3)
    expect(result.scene.elements).toHaveLength(6)
    expect(clone.id).not.toBe(source.id); expect(clone.x).toBe(180)
    expect(clone.customData).toBeUndefined(); expect(clonedLabel.customData).toBeUndefined()
    expect(clone.frameId).toBeNull(); expect(clone.groupIds).toEqual([])
    expect(clonedLabel.containerId).toBe(clone.id)
    expect(arrow.startBinding?.elementId).toBe(source.id); expect(arrow.endBinding?.elementId).toBe(clone.id)
    expect(result.selectedIds).toEqual([clone.id, clonedLabel.id])
    expect(JSON.stringify(original)).toBe(snapshot)
    expect(createConnectedShape(scene({ ...source, locked: true }), ['source'], 'ArrowDown')).toBeNull()
  })
  it('navigates actual bindings instead of nearby unconnected shapes without changing the scene', () => {
    const original = scene(box('source'), box('near', 120), box('target', 400), createElement('arrow', { x: 100, y: 30 }, { x: 400, y: 30 }, { startBinding: { elementId: 'source' }, endBinding: { elementId: 'target' } }))
    const before = JSON.stringify(original)
    expect(navigateConnection(original, ['source'], 'ArrowRight')).toEqual(['target'])
    expect(navigateConnection(original, ['target'], 'ArrowLeft')).toEqual(['source'])
    expect(navigateConnection(original, ['source'], 'ArrowUp')).toBeNull()
    expect(JSON.stringify(original)).toBe(before)
  })
  it('uses polygon intersection for concave lassos, rotated shapes and path crossings', () => {
    const concave = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 80 }, { x: 80, y: 80 }, { x: 80, y: 300 }, { x: 0, y: 300 }]
    const excluded = box('notch', 150, 150), included = box('included', 30, 100)
    expect(lassoSelection(scene(excluded, included), concave)).toEqual(['included'])
    const diamond = { ...box('diamond'), type: 'diamond' }
    expect(lassoSelection(scene(diamond), polygon(0, 0, 10, 10))).toEqual([])
    const path = createElement('line', { x: -100, y: 20 }, { x: 200, y: 20 }, { id: 'path' })
    expect(lassoSelection(scene(path), polygon(0, 0, 50, 50))).toEqual(['path'])
    const rotated = { ...box('rotated'), angle: Math.PI / 4 }
    expect(lassoSelection(scene(rotated), polygon(-8, -23, 5, 5))).toEqual([])
  })
  it('expands groups and frame membership, supports deep selection and excludes locked elements', () => {
    const a = { ...box('a', 10, 10), groupIds: ['g'] }, b = { ...box('b', 300), groupIds: ['g'] }, locked = { ...box('locked', 600), groupIds: ['g'], locked: true }
    const original = rerouteBindings(scene(a, b, locked))
    expect(lassoSelection(original, polygon(5, 5, 110, 70))).toEqual(['a', 'b'])
    expect(lassoSelection(original, polygon(5, 5, 110, 70), true)).toEqual(['a'])
    const frame = { ...box('frame'), type: 'frame' }, child = { ...box('child', 500), frameId: 'frame' }
    expect(lassoSelection(scene(frame, child), polygon(-5, -5, 110, 70))).toEqual(['frame', 'child'])
  })
})
