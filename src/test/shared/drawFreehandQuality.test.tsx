import { render } from '@testing-library/react'
import { expect, it } from 'vitest'
import DrawSceneSvg from '../../components/DrawSceneSvg'
import { compileDrawProposal } from '../../shared/drawCompiler'
import type { DrawProposal } from '../../shared/drawGeneration'
import { crossesBox } from '../helpers/drawGeometryOracle'

const pen: DrawProposal['elements'][number] = {
  id: 'pen', type: 'freedraw', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }],
  sourceId: null, targetId: null, label: '', strokeColor: '#222222',
}
const note: DrawProposal['elements'][number] = { id: 'note', type: 'text', text: 'X', x: 190, y: -35, fontSize: 12, strokeColor: '#222222' }
const proposal = (elements: DrawProposal['elements']): DrawProposal => ({ outputMode: 'draw', summary: 'Requested pen annotation', elements })

it('rejects a requested pen when its actual SVG curve overshoots into text', () => {
  const clear = compileDrawProposal(proposal([pen]))
  expect(clear.ok).toBe(true)
  if (!clear.ok) throw new Error(JSON.stringify(clear.issues))
  const { container } = render(<svg><DrawSceneSvg elements={clear.drawing.elements} files={{}} /></svg>)
  const path = container.querySelector('[data-element-id="pen"] path[stroke="#222222"]')!
  const command = path.getAttribute('d')!.match(/^M ([\d.-]+) ([\d.-]+) C ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+) ([\d.e+-]+)/)!
  expect(command).not.toBeNull()
  const [x0, y0, x1, y1, x2, y2, x3, y3] = command.slice(1).map(Number)
  const point = (t: number) => ({
    x: (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3 * x3,
    y: (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y3,
  })
  const textOnly = compileDrawProposal(proposal([note]))
  if (!textOnly.ok) throw new Error(JSON.stringify(textOnly.issues))
  const text = textOnly.drawing.elements[0] as { x: number; y: number; width: number; height: number }
  expect(crossesBox({ x: 0, y: 0 }, { x: 400, y: 0 }, text)).toBe(false)
  const intersectsActualCurve = Array.from({ length: 1000 }, (_, index) => crossesBox(point(index / 1000), point((index + 1) / 1000), text)).some(Boolean)
  expect(intersectsActualCurve).toBe(true)
  expect(compileDrawProposal(proposal([note, pen]))).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'text-overlap', elementIds: ['pen', 'note'] })] })
})

it('retains a clear requested curved pen without changing its authored points', () => {
  const result = compileDrawProposal(proposal([{ ...note, y: -60 }, pen]))
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  const element = result.drawing.elements.find(element => element.id === 'pen')!
  expect(element.points).toEqual([[0, 0], [400, 0], [400, 400]])
  const { container } = render(<svg><DrawSceneSvg elements={result.drawing.elements} files={{}} /></svg>)
  expect(container.querySelector('[data-element-id="pen"] path[stroke="#222222"]')).toHaveAttribute('d', expect.stringContaining(' C '))
})

it('rejects a curve overshooting into a frame title', () => {
  const frame: DrawProposal['elements'][number] = { id: 'frame', type: 'frame', x: 190, y: -5, width: 200, height: 200, name: 'X', children: [] }
  expect(compileDrawProposal(proposal([frame, pen]))).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'text-overlap', elementIds: ['pen', 'frame'] })] })
})
