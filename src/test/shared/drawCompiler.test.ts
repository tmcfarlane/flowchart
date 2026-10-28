import { describe, expect, it } from 'vitest'
import proposalFixture from '../../../docs/screenshots/ai-draw-tools/live-proposal.json'
import { compileDrawProposal, inspectDrawGeometry } from '../../shared/drawCompiler'
import { DrawProposalSchema, type DrawProposal } from '../../shared/drawGeneration'
import { drawingFromScene, parseDrawDocument, sceneFromDrawing } from '../../shared/drawDocument'
import { getWorldPoints, rerouteBindings, type DrawElement } from '../../utils/drawScene'
import { prepareSceneInsertion } from '../../utils/excalidrawImport'
import { crossesBox } from '../helpers/drawGeometryOracle'

const shape = (id: string, x: number, y: number, type: 'rectangle' | 'ellipse' | 'diamond' = 'rectangle', label = '') => ({ id, type, x, y, width: 180, height: 100, label, strokeColor: '#222222', backgroundColor: '#eeeeee' })
const arrow = (id: string, points: Array<{ x: number; y: number }>, sourceId: string | null, targetId: string | null, label = '') => ({ id, type: 'arrow' as const, points, sourceId, targetId, label, strokeColor: '#222222' })
const plan = (elements: DrawProposal['elements'], overlaps?: DrawProposal['overlaps']): DrawProposal => ({ outputMode: 'draw', summary: 'Test drawing', elements, ...(overlaps ? { overlaps } : {}) })
function compile(proposal: DrawProposal) {
  const result = compileDrawProposal(proposal)
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return sceneFromDrawing(result.drawing)
}
function clearConnectors(elements: DrawElement[]) {
  for (const path of elements.filter(element => ['arrow', 'line'].includes(element.type))) {
    const points = getWorldPoints(path)
    for (const box of elements.filter(element => ['rectangle', 'ellipse', 'diamond', 'text'].includes(element.type))) {
      if (box.id === path.startBinding?.elementId || box.id === path.endBinding?.elementId || box.containerId === path.id) continue
      for (let index = 1; index < points.length; index++) expect(crossesBox(points[index - 1], points[index], box), `${path.id} crosses ${box.id}`).toBe(false)
    }
  }
}

describe('canonical Draw compilation', () => {
  it('repairs the saved crossing and retains purposeful freehand', () => {
    const proposal = DrawProposalSchema.parse(proposalFixture), scene = compile(proposal)
    clearConnectors(scene.elements as DrawElement[])
    expect(scene.elements.some(element => element.id === 'pen_emphasis' && element.type === 'freedraw')).toBe(true)
    expect(inspectDrawGeometry(scene, proposal)).toEqual([])
    expect(compileDrawProposal(proposal)).toEqual(compileDrawProposal(proposal))
  })

  it('anchors every contour and preserves a shared horizontal row', () => {
    for (const type of ['rectangle', 'ellipse', 'diamond'] as const) {
      const scene = compile(plan([shape('a', 0, 0, type, 'A'), shape('b', 500, 0, type, 'B'), arrow('edge', [{ x: 180, y: 40 }, { x: 500, y: 40 }], 'a', 'b')]))
      const edge = scene.elements.find(element => element.id === 'edge') as DrawElement
      expect(getWorldPoints(edge).map(point => point.y)).toEqual([40, 40])
      for (const [binding, point] of [[edge.startBinding!, getWorldPoints(edge)[0]], [edge.endBinding!, getWorldPoints(edge)[getWorldPoints(edge).length - 1]]] as const) {
        const host = scene.elements.find(element => element.id === binding.elementId) as DrawElement
        const x = Math.abs((point.x - host.x - host.width / 2) / (host.width / 2)), y = Math.abs((point.y - host.y - host.height / 2) / (host.height / 2))
        const contour = type === 'ellipse' ? x * x + y * y : type === 'diamond' ? x + y : Math.max(x, y)
        expect(contour).toBeCloseTo(1, 8)
        expect(binding.fixedPoint).toHaveLength(2)
      }
    }
  })

  it('fits long words and padded labels inside curved contours', () => {
    for (const type of ['rectangle', 'ellipse', 'diamond'] as const) {
      const scene = compile(plan([shape('a', 0, 0, type, 'Observability commissioning checklist')]))
      const host = scene.elements.find(element => element.id === 'a') as DrawElement
      const label = scene.elements.find(element => element.type === 'text') as DrawElement
      expect(label.text).toContain('Observability')
      expect(label.text).not.toContain('Observa\nbility')
      expect(label.autoResize).toBe(true)
      expect(label.lineHeight).toBe(1.5)
      for (const px of [label.x - 8, label.x + label.width + 8]) for (const py of [label.y - 8, label.y + label.height + 8]) {
        const x = Math.abs((px - host.x - host.width / 2) / (host.width / 2)), y = Math.abs((py - host.y - host.height / 2) / (host.height / 2))
        expect(type === 'ellipse' ? x * x + y * y : type === 'diamond' ? x + y : Math.max(x, y)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('preserves a clear authored detour and its native midpoint caption', () => {
    const points = [{ x: 180, y: 50 }, { x: 260, y: 50 }, { x: 260, y: 300 }, { x: 720, y: 300 }, { x: 720, y: 50 }, { x: 800, y: 50 }]
    const scene = compile(plan([shape('a', 0, 0), shape('b', 800, 0), arrow('edge', points, 'a', 'b', 'A clear handoff')]))
    const edge = scene.elements.find(element => element.id === 'edge') as DrawElement
    expect(getWorldPoints(edge)).toEqual(points)
    const caption = scene.elements.find(element => element.containerId === 'edge') as DrawElement
    expect(caption.x + caption.width / 2).toBe(490)
    expect(caption.y + caption.height / 2).toBe(300)
    clearConnectors(scene.elements as DrawElement[])
  })

  it('allows only named intentional overlaps and still protects text', () => {
    const shapes = [shape('a', 0, 0, 'ellipse'), shape('b', 130, 0, 'ellipse')]
    expect(compileDrawProposal(plan(shapes))).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'object-overlap' })] })
    compile(plan(shapes, [{ firstId: 'a', secondId: 'b', reason: 'venn' }]))
    expect(compileDrawProposal(plan([...shapes, { id: 'note', type: 'text', x: 140, y: 20, text: 'Protected', fontSize: 18, strokeColor: '#222222' }], [{ firstId: 'a', secondId: 'b', reason: 'venn' }]))).toMatchObject({ ok: false })
  })

  it('keeps native rerouting, translation and document export stable', () => {
    const proposal = DrawProposalSchema.parse(proposalFixture), scene = compile(proposal)
    let rerouted = scene
    for (let index = 0; index < 5; index++) rerouted = rerouteBindings(rerouted)
    for (let index = 0; index < scene.elements.length; index++) {
      const before = scene.elements[index] as DrawElement, after = rerouted.elements[index] as DrawElement
      expect(after.x).toBeCloseTo(before.x, 8)
      expect(after.y).toBeCloseTo(before.y, 8)
      if (before.points) getWorldPoints(before).forEach((point, i) => {
        expect(getWorldPoints(after)[i].x).toBeCloseTo(point.x, 8)
        expect(getWorldPoints(after)[i].y).toBeCloseTo(point.y, 8)
      })
    }
    expect(sceneFromDrawing(parseDrawDocument(JSON.parse(JSON.stringify(drawingFromScene(scene)))))).toEqual(scene)
    const inserted = prepareSceneInsertion(scene, { version: 1, elements: [], files: {} }, { x: 200, y: 100 })
    expect(inserted.elements).toHaveLength(scene.elements.length)
    const dx = Number(inserted.elements[0].x) - Number(scene.elements[0].x), dy = Number(inserted.elements[0].y) - Number(scene.elements[0].y)
    for (let index = 0; index < scene.elements.length; index++) {
      const before = scene.elements[index] as DrawElement, after = inserted.elements[index] as DrawElement
      expect(after.id).not.toBe(before.id)
      expect(after.x - before.x).toBeCloseTo(dx, 8)
      expect(after.y - before.y).toBeCloseTo(dy, 8)
      expect(after.points).toEqual(before.points)
      expect(after.startBinding?.fixedPoint).toEqual(before.startBinding?.fixedPoint)
      expect(after.endBinding?.fixedPoint).toEqual(before.endBinding?.fixedPoint)
    }
    expect(sceneFromDrawing(parseDrawDocument(JSON.parse(JSON.stringify(drawingFromScene(inserted)))))).toEqual(inserted)
  })


  it('finds a clear midpoint shaft for a long caption around an obstacle', () => {
    const proposal = plan([shape('a', 0, 0), shape('b', 900, 0), shape('obstacle', 400, -20), arrow('edge', [{ x: 180, y: 50 }, { x: 900, y: 50 }], 'a', 'b', 'Review launch readiness together')])
    const scene = compile(proposal)
    clearConnectors(scene.elements as DrawElement[])
    const edge = scene.elements.find(element => element.id === 'edge') as DrawElement
    const caption = scene.elements.find(element => element.containerId === 'edge') as DrawElement
    const center = { x: caption.x + caption.width / 2, y: caption.y + caption.height / 2 }, points = getWorldPoints(edge)
    const shaft = points.slice(1).some((b, index) => {
      const a = points[index]
      return a.y === b.y && Math.abs(center.y - a.y) < 0.0001 && Math.min(a.x, b.x) < caption.x - 10 && Math.max(a.x, b.x) > caption.x + caption.width + 10
    })
    expect(shaft).toBe(true)
  })

  it('reserves a wider outside corridor when a nearby pair needs a long caption', () => {
    const scene = compile(plan([shape('a', 0, 0), shape('b', 250, 0), arrow('edge', [{ x: 180, y: 50 }, { x: 250, y: 50 }], 'a', 'b', 'Review handoff together')]))
    clearConnectors(scene.elements as DrawElement[])
  })

  it('keeps a line caption at its native center on a visible shaft', () => {
    const scene = compile(plan([{ ...arrow('line', [{ x: 0, y: 0 }, { x: 500, y: 0 }], null, null, 'Section divider'), type: 'line' }]))
    const caption = scene.elements.find(element => element.type === 'text') as DrawElement
    expect(caption.x + caption.width / 2).toBe(250)
    expect(caption.y + caption.height / 2).toBe(0)
    expect(rerouteBindings(scene)).toEqual(scene)
  })

  it('rejects a blocked endpoint and a caption without enough shaft', () => {
    const blocked = plan([shape('a', 0, 0), shape('b', 1000, 0), { ...shape('cover', -20, -20), width: 220, height: 140 }, arrow('edge', [{ x: 180, y: 50 }, { x: 1000, y: 50 }], 'a', 'b')], [{ firstId: 'a', secondId: 'cover', reason: 'container' }])
    expect(compileDrawProposal(blocked)).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'route-blocked' })] })
    expect(compileDrawProposal(plan([arrow('short', [{ x: 0, y: 0 }, { x: 20, y: 0 }], null, null, 'No room for this caption')]))).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'caption-blocked' })] })
  })

  it('diagnoses hidden shared shafts and malformed native geometry', () => {
    expect(compileDrawProposal(plan([arrow('a', [{ x: 0, y: 0 }, { x: 500, y: 0 }], null, null), arrow('b', [{ x: 100, y: 0 }, { x: 400, y: 0 }], null, null)]))).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'connector-overlap' })] })
    const proposal = plan([shape('a', 0, 0), shape('b', 500, 0), arrow('edge', [{ x: 180, y: 50 }, { x: 500, y: 50 }], 'a', 'b')])
    const scene = compile(proposal)
    const edge = scene.elements.find(element => element.id === 'edge') as DrawElement
    edge.roundness = { type: 2 }
    expect(inspectDrawGeometry(scene, proposal)).toContainEqual(expect.objectContaining({ code: 'unsupported-geometry' }))
    edge.startBinding!.elementId = 'missing'
    expect(inspectDrawGeometry(scene, proposal)).toContainEqual(expect.objectContaining({ code: 'native-document' }))
  })

  it('protects frame titles from connector and freehand strokes', () => {
    const frame = { id: 'frame', type: 'frame' as const, x: 100, y: 100, width: 400, height: 300, name: 'Protected title', children: [] }
    const points = [{ x: 50, y: 80 }, { x: 400, y: 80 }]
    const scene = compile(plan([frame, arrow('edge', points, null, null)]))
    const edge = scene.elements.find(element => element.id === 'edge') as DrawElement
    expect(getWorldPoints(edge)).not.toEqual(points)
    const stroke = { ...arrow('pen', points, null, null), type: 'freedraw' as const }
    expect(compileDrawProposal(plan([frame, stroke]))).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'text-overlap', elementIds: ['pen', 'frame'] })] })
  })

  it('returns bounded resource diagnostics for a large visibility graph', () => {
    const shapes = Array.from({ length: 90 }, (_, index) => ({ ...shape(`node-${index}`, index * 100, index * 100), width: 40, height: 40 }))
    const result = compileDrawProposal(plan([...shapes, arrow('edge', [{ x: -100, y: 20 }, { x: 9000, y: 20 }], null, null)]))
    expect(result).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'geometry-budget' })] })
  })
})
