import { describe, expect, it } from 'vitest'
import { drawingFromScene, parseDrawDocument, sceneFromDrawing } from '../shared/drawDocument'
import type { ArchitectureScene } from '../shared/architectureScene'

const scene: ArchitectureScene = { version: 1, elements: [
  { id: 'box', type: 'rectangle', x: -50, y: 20, width: 180, height: 90, angle: 0, boundElements: [{ id: 'arrow', type: 'arrow' }], customData: { retained: 'exact' } },
  { id: 'arrow', type: 'arrow', x: 130, y: 65, width: 200, height: 20, angle: 0, points: [[0, 0], [100, 0], [200, 20]], startBinding: { elementId: 'box', fixedPoint: [1, 0.5] }, endBinding: null },
], files: {}, appState: { viewBackgroundColor: '#fff', gridSize: null } }

describe('canonical drawing documents', () => {
  it('round-trips geometry, bindings, unknown native fields and app state without rewriting', () => {
    const drawing = drawingFromScene(scene)
    expect(drawing).toMatchObject({ type: 'excalidraw', version: 2, source: 'FlowChart' })
    expect(sceneFromDrawing(JSON.parse(JSON.stringify(drawing)))).toEqual(scene)
    expect(drawing.elements).toBe(scene.elements)
    expect(parseDrawDocument(drawing)).toBe(drawing)
  })

  it('preserves an omitted appState', () => {
    const { appState: _state, ...withoutState } = scene
    expect(drawingFromScene(withoutState)).not.toHaveProperty('appState')
    expect(sceneFromDrawing(drawingFromScene(withoutState))).toEqual(withoutState)
  })

  it.each([
    { version: 1 }, { type: 'drawing' }, { source: '' }, { extra: true },
    { elements: [{ ...scene.elements[1], points: [['unsafe', 0]] }] },
    { elements: [{ ...scene.elements[0], id: 'one' }, { ...scene.elements[0], id: 'one' }] },
    { elements: [{ ...scene.elements[0], x: Infinity }] },
    { elements: [{ ...scene.elements[0], type: 'text', text: 'label', fontSize: -1 }] },
    { elements: [{ ...scene.elements[0], boundElements: null, startBinding: { elementId: 'box', fixedPoint: [2, 0] } }] },
  ])('rejects an invalid finalized document %#', changes => {
    expect(() => parseDrawDocument({ ...drawingFromScene(scene), ...changes })).toThrow()
  })
})
