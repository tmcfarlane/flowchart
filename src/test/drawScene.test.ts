import { describe, expect, it } from 'vitest'
import type { ArchitectureScene } from '../shared/architectureScene'
import { validateArchitectureScene } from '../shared/architectureScene'
import {
  alignElements, createElement, deleteElements, duplicateSelection, expandSelection,
  getElementBounds, getElementCenter, getSceneBounds, getWorldPoints, groupElements,
  moveElements, reorderElements, rerouteBindings, resizeElement, rotateElements,
  setElementProperties, ungroupElements, type DrawElement,
} from '../utils/drawScene'

const rectangle = (id: string, x = 0, y = 0, width = 100, height = 80, extra: Partial<DrawElement> = {}) => createElement('rectangle', { x, y }, { x: x + width, y: y + height }, { id, ...extra })
const scene = (...elements: DrawElement[]): ArchitectureScene => ({ version: 1, elements, files: {} })
const element = (drawing: ArchitectureScene, id: string) => drawing.elements.find(item => item.id === id) as DrawElement
const bindArrow = () => createElement('arrow', { x: 100, y: 40 }, { x: 300, y: 40 }, {
  id: 'arrow', startBinding: { elementId: 'left', fixedPoint: [1, 0.5] }, endBinding: { elementId: 'right', fixedPoint: [0, 0.5] },
  points: [[0, 0], [80, 90], [200, 0]], strokeStyle: 'dashed', endArrowhead: 'diamond',
})

describe('custom Draw creation and geometry', () => {
  it('creates shapes at dragged bounds and retains reverse path directions', () => {
    expect(createElement('ellipse', { x: 70, y: 80 }, { x: -20, y: 10 })).toMatchObject({ type: 'ellipse', x: -20, y: 10, width: 90, height: 70, angle: 0 })
    const path = createElement('line', { x: 70, y: 80 }, { x: -20, y: 10 })
    expect(path).toMatchObject({ x: 70, y: 80, points: [[0, 0], [-90, -70]] })
    expect(getElementBounds(path)).toEqual({ x: -20, y: 10, width: 90, height: 70 })
  })

  it('includes rotation, negative positions and negative path coordinates in fit bounds', () => {
    const rotated = rectangle('rotated', -100, -50, 100, 40, { angle: Math.PI / 2 })
    const bounds = getElementBounds(rotated)
    expect(bounds.x).toBeCloseTo(-70)
    expect(bounds.y).toBeCloseTo(-80)
    expect(bounds.width).toBeCloseTo(40)
    expect(bounds.height).toBeCloseTo(100)
    const path = createElement('line', { x: 100, y: 100 }, { x: 20, y: 60 }, { angle: Math.PI / 2 })
    expect(getElementCenter(path)).toEqual({ x: 60, y: 80 })
    expect(getSceneBounds([rotated, path]).width).toBeGreaterThan(100)
  })

  it('resizes reverse and initially flat paths into the requested bounds', () => {
    const reverse = createElement('line', { x: 100, y: 50 }, { x: 0, y: 50 }, { id: 'line' })
    const resized = resizeElement(scene(reverse), 'line', { x: 20, y: 30, width: 200, height: 80 })
    expect(getElementBounds(element(resized, 'line'))).toEqual({ x: 20, y: 30, width: 200, height: 80 })
    expect(getWorldPoints(element(resized, 'line'))).toEqual([{ x: 220, y: 30 }, { x: 20, y: 110 }])
  })

  it('moves and resizes pen strokes without changing pressure, rotation or unknown imported styles', () => {
    const pen = createElement('freedraw', { x: -10, y: 5 }, { x: 90, y: 65 }, {
      id: 'pen', points: [[0, 0], [40, 60], [100, 10]], pressures: [0.2, 0.9, 0.4], angle: 0.4,
      customData: { arbitraryImporterField: { preserve: true } }, strokeColor: '#c92a2a', roughness: 2,
    })
    const original = scene(pen), before = JSON.stringify(original)
    const moved = moveElements(original, ['pen'], { x: 50, y: -20 })
    const resized = resizeElement(moved, 'pen', { x: 40, y: -15, width: 200, height: 120 })
    expect(element(resized, 'pen')).toMatchObject({ pressures: [0.2, 0.9, 0.4], angle: 0.4, strokeColor: '#c92a2a', roughness: 2, customData: pen.customData, points: [[0, 0], [80, 120], [200, 20]] })
    expect(JSON.stringify(original)).toBe(before)
  })
})

describe('custom Draw attachments', () => {
  it('keeps arrows attached through move, resize and rotate, preserving manual path points and labels', () => {
    const label = createElement('text', { x: 180, y: 50 }, undefined, { id: 'label', text: 'event', containerId: 'arrow', width: 50, height: 20 })
    const original = scene(rectangle('left'), rectangle('right', 300), bindArrow(), label)
    const moved = moveElements(original, ['left'], { x: 20, y: 30 })
    expect(getWorldPoints(element(moved, 'arrow'))[0]).toMatchObject({ x: 120, y: 70 })
    expect(getWorldPoints(element(moved, 'arrow'))[1]).toMatchObject({ x: 180, y: 130 })
    const resized = resizeElement(moved, 'right', { x: 300, y: 0, width: 200, height: 120 })
    expect(getWorldPoints(element(resized, 'arrow')).at(-1)).toMatchObject({ x: 300, y: 60 })
    const rotated = rotateElements(resized, ['left'], Math.PI / 2)
    const start = getWorldPoints(element(rotated, 'arrow'))[0]
    expect(start.x).toBeCloseTo(70)
    expect(start.y).toBeCloseTo(120)
    expect(element(rotated, 'arrow')).toMatchObject({ strokeStyle: 'dashed', endArrowhead: 'diamond' })
    expect(element(rotated, 'label').containerId).toBe('arrow')
    expect(element(rotated, 'left').boundElements).toContainEqual({ id: 'arrow', type: 'arrow' })
    expect(validateArchitectureScene(rotated)).toBe(rotated)
  })

  it('preserves an imported arrow angle when rerouting its endpoint', () => {
    const arrow = { ...bindArrow(), angle: 0.7 }
    const drawing = scene(rectangle('left'), rectangle('right', 300), arrow)
    const result = moveElements(drawing, ['right'], { x: 40, y: 20 })
    expect(element(result, 'arrow').angle).toBe(0.7)
    const target = getWorldPoints(element(result, 'arrow')).at(-1)!
    expect(target.x).toBeCloseTo(340)
    expect(target.y).toBeCloseTo(60)
  })

  it('keeps imported elbow segments orthogonal after moving or resizing attached shapes', () => {
    const arrow = createElement('arrow', { x: 100, y: 40 }, { x: 300, y: 200 }, {
      id: 'elbow', elbowed: true, points: [[0, 0], [100, 0], [100, 160], [200, 160]],
      startBinding: { elementId: 'left', fixedPoint: [1, 0.5] }, endBinding: { elementId: 'right', fixedPoint: [0, 0.5] },
    })
    const drawing = scene(rectangle('left'), rectangle('right', 300, 160), arrow)
    const moved = moveElements(drawing, ['left'], { x: 30, y: 70 })
    const resized = resizeElement(moved, 'right', { x: 350, y: 140, width: 180, height: 120 })
    const points = getWorldPoints(element(resized, 'elbow'))
    expect(points[0]).toMatchObject({ x: 130, y: 110 })
    expect(points.at(-1)).toMatchObject({ x: 350, y: 200 })
    points.slice(1).forEach((point, index) => {
      expect(Math.min(Math.abs(point.x - points[index].x), Math.abs(point.y - points[index].y))).toBeLessThan(0.0001)
    })
  })

  it('restores imported focus/gap bindings without needing editor APIs', () => {
    const arrow = createElement('arrow', { x: 150, y: 40 }, { x: 300, y: 40 }, { id: 'arrow', startBinding: { elementId: 'left', gap: 5 }, endBinding: { elementId: 'right', gap: 0 } })
    const drawing = rerouteBindings(scene(rectangle('left'), rectangle('right', 300), arrow))
    const points = getWorldPoints(element(drawing, 'arrow'))
    expect(points[0]).toEqual({ x: 105, y: 40 })
    expect(points[1]).toEqual({ x: 300, y: 40 })
  })

  it('deletes a bound label with its shape and detaches surviving arrows without dangling references', () => {
    const text = createElement('text', { x: 10, y: 20 }, undefined, { id: 'text', containerId: 'left' })
    const drawing = scene(rectangle('left'), rectangle('right', 300), bindArrow(), text)
    const deleted = deleteElements(drawing, ['left'])
    expect(element(deleted, 'left').isDeleted).toBe(true)
    expect(element(deleted, 'text').isDeleted).toBe(true)
    expect(element(deleted, 'arrow').startBinding).toBeNull()
    expect(element(deleted, 'arrow').endBinding?.elementId).toBe('right')
    expect(validateArchitectureScene(deleted)).toBe(deleted)
  })
})

describe('custom Draw groups, frames and duplication', () => {
  it('moves frame contents and labels as a unit and distinguishes deep selection from groups', () => {
    const frame = createElement('frame', { x: -20, y: -20 }, { x: 200, y: 150 }, { id: 'frame' })
    const text = createElement('text', { x: 10, y: 20 }, undefined, { id: 'text', containerId: 'child' })
    const drawing = scene(frame, rectangle('child', 0, 0, 100, 80, { frameId: 'frame' }), text, rectangle('other', 500))
    expect(expandSelection(drawing, ['frame']).sort()).toEqual(['child', 'frame', 'text'])
    const grouped = groupElements(drawing, ['child', 'other'], 'visual-group')
    expect(expandSelection(grouped, ['child'])).toContain('other')
    expect(expandSelection(grouped, ['child'], true)).not.toContain('other')
    expect(element(moveElements(grouped, ['child'], { x: 20, y: 30 }, true), 'other').x).toBe(500)
    const moved = moveElements(drawing, ['frame'], { x: 40, y: 60 })
    expect(element(moved, 'child')).toMatchObject({ x: 40, y: 60, frameId: 'frame' })
    expect(ungroupElements(grouped, ['child']).elements.every(item => !(item.groupIds as string[]).includes('visual-group'))).toBe(true)
  })

  it('duplicates independent image assets, geometry and every element/group/frame reference repeatedly', () => {
    const frame = createElement('frame', { x: -100, y: -50 }, { x: 500, y: 300 }, { id: 'frame', groupIds: ['group'] })
    const a = rectangle('left', 0, 0, 100, 80, { frameId: 'frame', groupIds: ['group'], angle: 0.3 })
    const b = rectangle('right', 300, 0, 100, 80, { frameId: 'frame', groupIds: ['group'] })
    const arrow = { ...bindArrow(), frameId: 'frame', groupIds: ['group'] }
    const label = createElement('text', { x: 180, y: 80 }, undefined, { id: 'label', containerId: 'arrow', frameId: 'frame', text: 'queue' })
    const image = createElement('image', { x: 10, y: 90 }, { x: 50, y: 130 }, { id: 'image', fileId: 'asset', frameId: 'frame' })
    const drawing = scene(frame, a, b, arrow, label, image)
    drawing.files.asset = { id: 'asset', dataURL: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', created: 1 }
    const first = duplicateSelection(drawing, ['frame'])
    const copies = first.scene.elements.filter(item => first.selectedIds.includes(String(item.id))) as DrawElement[]
    const copiedFrame = copies.find(item => item.type === 'frame')!, copiedArrow = copies.find(item => item.type === 'arrow')!, copiedImage = copies.find(item => item.type === 'image')!
    expect(copies).toHaveLength(6)
    expect(copies.find(item => item.id === copiedArrow.startBinding?.elementId)?.angle).toBe(0.3)
    expect(copies.filter(item => item.type !== 'frame').every(item => item.frameId === copiedFrame.id)).toBe(true)
    expect(copies.find(item => item.type === 'text')?.containerId).toBe(copiedArrow.id)
    expect(copiedImage.fileId).not.toBe('asset')
    expect(first.scene.files[copiedImage.fileId!]).toMatchObject({ dataURL: drawing.files.asset.dataURL })
    const second = duplicateSelection(first.scene, ['frame'])
    expect(new Set(second.scene.elements.map(item => item.id)).size).toBe(second.scene.elements.length)
    expect(Object.keys(second.scene.files)).toHaveLength(3)
    expect(validateArchitectureScene(second.scene)).toBe(second.scene)
    expect(drawing.elements).toHaveLength(6)
    expect(Object.keys(drawing.files)).toEqual(['asset'])
  })

  it('remaps semantic node, parent, icon and edge IDs without losing protocol metadata', () => {
    const metadata = (kind: string, id: string, snapshot?: Record<string, unknown>) => ({ flowchart: { kind, id, ...(snapshot ? { snapshot } : {}) } })
    const container = rectangle('container', 0, 0, 500, 300, { groupIds: ['fc-container-parent'], customData: metadata('node', 'parent', { id: 'parent', type: 'container' }) })
    const child = rectangle('child', 20, 60, 100, 80, { groupIds: ['fc-container-parent'], customData: metadata('node', 'api', { id: 'api', type: 'service', parentNode: 'parent' }) })
    const icon = createElement('image', { x: 25, y: 65 }, undefined, { id: 'icon', fileId: 'asset', groupIds: ['fc-container-parent'], customData: metadata('icon', 'api') })
    const edge = createElement('arrow', { x: 0, y: 0 }, { x: 20, y: 60 }, { id: 'edge', groupIds: ['fc-container-parent'], startBinding: { elementId: 'container' }, endBinding: { elementId: 'child' }, customData: metadata('edge', 'connection', { id: 'connection', source: 'parent', target: 'api', protocol: 'HTTPS', commStyle: 'sync' }) })
    const drawing = scene(container, child, icon, edge)
    drawing.files.asset = { id: 'asset', dataURL: 'data:image/png;base64,aGVsbG8=' }
    const result = duplicateSelection(drawing, ['container'])
    const copies = result.scene.elements.filter(item => result.selectedIds.includes(String(item.id))) as DrawElement[]
    const meta = (item: DrawElement) => item.customData!.flowchart as { kind: string; id: string; snapshot: Record<string, unknown> }
    const parent = copies.find(item => meta(item).snapshot?.type === 'container')!, api = copies.find(item => meta(item).snapshot?.type === 'service')!
    expect(meta(api).snapshot.parentNode).toBe(meta(parent).id)
    expect(meta(copies.find(item => meta(item).kind === 'icon')!).id).toBe(meta(api).id)
    expect(meta(copies.find(item => meta(item).kind === 'edge')!).snapshot).toMatchObject({ source: meta(parent).id, target: meta(api).id, protocol: 'HTTPS', commStyle: 'sync' })
  })

  it('retains object order, styles and locks across keyboard-friendly operations', () => {
    const drawing = scene(rectangle('a', 0), rectangle('b', 300), rectangle('locked', 500, 0, 100, 80, { locked: true }))
    expect(element(moveElements(drawing, ['locked'], { x: 50, y: 50 }), 'locked').x).toBe(500)
    expect(element(deleteElements(drawing, ['locked']), 'locked').isDeleted).toBe(false)
    const styled = setElementProperties(drawing, ['a'], { opacity: 40, strokeStyle: 'dotted', roughness: 2 })
    expect(element(styled, 'a')).toMatchObject({ opacity: 40, strokeStyle: 'dotted', roughness: 2 })
    expect(reorderElements(styled, ['a'], 'front').elements.map(item => item.id)).toEqual(['b', 'locked', 'a'])
    expect(element(alignElements(drawing, ['a', 'b'], 'left'), 'b').x).toBe(0)
  })
})
