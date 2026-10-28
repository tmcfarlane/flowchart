import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import DrawSceneSvg from '../../components/DrawSceneSvg'
import { compileDrawProposal, inspectDrawGeometry } from '../../shared/drawCompiler'
import type { DrawProposal } from '../../shared/drawGeneration'
import { sceneFromDrawing } from '../../shared/drawDocument'
import { getWorldPoints, type DrawElement } from '../../utils/drawScene'
import { crossesBox } from '../helpers/drawGeometryOracle'

const card = (id: string, x: number) => ({ id, type: 'rectangle' as const, x, y: 0, width: 180, height: 100, label: '', strokeColor: '#222222', backgroundColor: '#eeeeee' })
const plan: DrawProposal = { outputMode: 'draw', summary: 'Two nearby cards', elements: [card('a', 0), card('b', 184), { id: 'edge', type: 'arrow', points: [{ x: 180, y: 50 }, { x: 184, y: 50 }], sourceId: 'a', targetId: 'b', label: '', strokeColor: '#222222' }] }

it('keeps the actual SVG arrowhead clear of the source on a tiny connection', () => {
  const result = compileDrawProposal(plan)
  if (!result.ok) {
    expect(result.issues.some(issue => ['route-blocked', 'marker-blocked'].includes(issue.code))).toBe(true)
    return
  }
  const edge = result.drawing.elements.find(element => element.id === 'edge') as DrawElement
  const points = getWorldPoints(edge), tip = points[points.length - 1], previous = points[points.length - 2]
  const length = Math.hypot(tip.x - previous.x, tip.y - previous.y), ux = (tip.x - previous.x) / length, uy = (tip.y - previous.y) / length
  const { container } = render(<svg><DrawSceneSvg elements={result.drawing.elements} files={{}} /></svg>)
  const marker = container.querySelector('[data-element-id="edge"] marker path')!
  const markerElement = marker.parentElement!, viewBox = markerElement.getAttribute('viewBox')!.split(' ').map(Number)
  const scale = Math.min(Number(markerElement.getAttribute('markerWidth')) / viewBox[2], Number(markerElement.getAttribute('markerHeight')) / viewBox[3])
  const coordinates = marker.getAttribute('d')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  const world = Array.from({ length: coordinates.length / 2 }, (_, index) => {
    const x = coordinates[index * 2] * scale, y = coordinates[index * 2 + 1] * scale
    return { x: tip.x + x * ux - y * uy, y: tip.y + x * uy + y * ux }
  })
  expect(world.slice(1).some((point, index) => crossesBox(world[index], point, card('a', 0)))).toBe(false)
  expect(length).toBeGreaterThanOrEqual(32)
})

it('rejects a short final segment after a bend in final geometry inspection', () => {
  const unbound: DrawProposal = { ...plan, elements: [{ id: 'edge', type: 'arrow', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], sourceId: null, targetId: null, label: '', strokeColor: '#222222' }] }
  const result = compileDrawProposal(unbound)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  const scene = sceneFromDrawing(result.drawing), edge = scene.elements.find(element => element.id === 'edge') as DrawElement
  edge.points = [[0, 0], [96, 0], [96, 50], [100, 50]]
  edge.width = 100
  edge.height = 50
  expect(inspectDrawGeometry(scene, unbound)).toContainEqual(expect.objectContaining({ code: 'marker-blocked', elementIds: ['edge'] }))
})
