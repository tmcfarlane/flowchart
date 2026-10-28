import { describe, expect, it } from 'vitest'
import captured from '../../../docs/screenshots/ai-draw-tools/live-export.json'
import { crossesBox } from '../helpers/drawGeometryOracle'

describe('captured Draw crossing', () => {
  it('keeps the saved handoff clear of the launch card', () => {
    const elements = captured.architectureScene.elements
    const caption = elements.find(element => 'text' in element && element.text === 'handoff')!
    const path = elements.find(element => element.id === caption.containerId)!
    const label = elements.find(element => 'text' in element && element.text?.startsWith('Finalize launch'))!
    const card = elements.find(element => element.id === label.containerId)!
    const points = path.points!.map(([x, y]) => ({ x: path.x + x, y: path.y + y }))
    const intersects = points.slice(1).some((point, index) => crossesBox(points[index], point, card))
    expect(intersects).toBe(false)
  })
})
