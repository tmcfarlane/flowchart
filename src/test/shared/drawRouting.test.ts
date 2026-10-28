import { expect, it } from 'vitest'
import { routeConnector } from '../../shared/drawRouting'
import type { DrawElement } from '../../utils/drawScene'
import { crossesBox } from '../helpers/drawGeometryOracle'

it('routes around staggered walls with an independent clearance oracle', () => {
  const path: DrawElement = { id: 'route', type: 'arrow', x: 0, y: 0, width: 900, height: 0, angle: 0, points: [[0, 0], [900, 0]] }
  const obstacles = [
    { id: 'a', x: 100, y: -400, width: 100, height: 500 },
    { id: 'b', x: 350, y: -100, width: 100, height: 500 },
    { id: 'c', x: 600, y: -400, width: 100, height: 500 },
  ]
  const points = routeConnector(path, undefined, undefined, undefined, obstacles, { remaining: 3_000_000 })
  expect(points).not.toBeNull()
  for (const box of obstacles) for (let index = 1; index < points!.length; index++) expect(crossesBox(points![index - 1], points![index], box)).toBe(false)
})
