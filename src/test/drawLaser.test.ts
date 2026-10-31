import { describe, expect, it } from 'vitest'
import { LASER_DECAY_MS, pruneLaserPoints } from '../components/DrawLaser'

describe('pruneLaserPoints', () => {
  const at = (t: number) => ({ x: t, y: 0, t })
  it('drops decayed points, keeping one as the start of the first live segment and always the newest', () => {
    expect(pruneLaserPoints([at(0), at(100), at(500), at(900)], 1200)).toEqual([at(100), at(500), at(900)])
    expect(pruneLaserPoints([at(0), at(10)], 10 + LASER_DECAY_MS + 1)).toEqual([at(10)])
    const fresh = [at(100), at(200)]
    expect(pruneLaserPoints(fresh, 300)).toBe(fresh)
  })
})
