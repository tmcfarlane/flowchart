import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import { getDiagramExportGeometry } from '../utils/exportGeometry'

const node = (id: string, x: number, y: number, width = 180, height = 90, parentNode?: string): Node => ({
  id, type: 'service', position: { x, y }, width, height, parentNode, data: { label: id },
})

describe('Entire diagram export geometry', () => {
  it('includes distant off-screen nodes, negative positions and nested children without changing the graph', () => {
    const nodes = [
      { ...node('outer', -500, -300, 900, 600), type: 'container' },
      { ...node('inner', 50, 70, 600, 400, 'outer'), type: 'container' },
      node('leaf', 30, 40, 180, 90, 'inner'), node('distant', 9000, 2000),
    ]
    const original = JSON.stringify(nodes)
    const result = getDiagramExportGeometry(nodes, 4096)
    expect(result.bounds).toEqual({ x: -500, y: -300, width: 9680, height: 2390 })
    expect(result.width).toBe(4096)
    expect(result.height).toBeLessThan(4096)
    expect(result.zoom).toBeCloseTo(4016 / 9680)
    for (const [x, y] of [[-500, -300], [9180, 2090]]) {
      expect((x - result.bounds.x) * result.zoom + 40).toBeGreaterThanOrEqual(40)
      expect((y - result.bounds.y) * result.zoom + 40).toBeGreaterThanOrEqual(40)
    }
    expect(JSON.stringify(nodes)).toBe(original)
  })
  it('fits visible edge curves and captions beyond the node bounds', () => {
    const result = getDiagramExportGeometry([node('a', 0, 0)], 1280, [
      { x: -250, y: -80, width: 700, height: 60 },
      { x: 50, y: 200, width: 250, height: 40 },
    ])
    expect(result.bounds).toEqual({ x: -250, y: -80, width: 700, height: 320 })
    expect(result).toMatchObject({ width: 780, height: 400, zoom: 1 })
    expect(result.transform).toBe('translate(290px, 120px) scale(1)')
  })
  it('uses measured sizes before styles, falls back by node type, and excludes hidden nodes', () => {
    const measured = { ...node('a', 0, 0, 220, 110), style: { width: 1000, height: 1000 } }
    const fallback: Node = { id: 'b', type: 'decision', position: { x: 300, y: 0 }, data: {} }
    const result = getDiagramExportGeometry([measured, fallback, { ...node('hidden', 50000, 0), hidden: true }], 1280)
    expect(result.bounds).toEqual({ x: 0, y: 0, width: 460, height: 160 })
    expect(result.width).toBe(540); expect(result.height).toBe(240)
  })
  it.each([4096, 1280])('keeps both dimensions inside the %ipx format limit for very wide or tall diagrams', (maximum) => {
    for (const nodes of [[node('a', -1000000, 0), node('b', 1000000, 0)], [node('a', 0, -1000000), node('b', 0, 1000000)]]) {
      const result = getDiagramExportGeometry(nodes, maximum)
      expect(result.width).toBeLessThanOrEqual(maximum)
      expect(result.height).toBeLessThanOrEqual(maximum)
      expect(result.width).toBeGreaterThan(80); expect(result.height).toBeGreaterThan(80)
    }
  })
  it('rejects empty diagrams and unready geometry without accepting invalid extra bounds', () => {
    expect(() => getDiagramExportGeometry([], 4096)).toThrow('Current view')
    expect(() => getDiagramExportGeometry([node('a', NaN, 0)], 4096)).toThrow('not ready')
    expect(() => getDiagramExportGeometry([node('a', 0, 0, 0)], 4096)).toThrow('not ready')
    expect(() => getDiagramExportGeometry([node('a', 0, 0, 5001)], 4096)).toThrow('not ready')
    expect(() => getDiagramExportGeometry([node('a', 0, 0)], 80)).toThrow('supported export size')
    expect(getDiagramExportGeometry([node('a', 0, 0)], 4096, [{ x: NaN, y: 0, width: 1, height: 1 }]).bounds.width).toBe(180)
  })
})
