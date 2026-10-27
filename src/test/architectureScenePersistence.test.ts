import { describe, expect, it } from 'vitest'
import { serializeFlow, parseFlowJson } from '../utils/exportUtils'
import { contentFingerprint, flowToChart } from '../utils/sharedFlow'
import type { ArchitectureScene } from '../shared/architectureScene'

const drawing: ArchitectureScene = { version: 1, elements: [{ id: 'pen', type: 'freedraw', x: -40, y: 5, width: 100, height: 60, angle: 0, points: [[0, 0], [40, 60], [100, 10]], pressures: [0.5, 0.6, 0.4], strokeColor: '#099268', groupIds: ['group'] }], files: {}, appState: { viewBackgroundColor: '#ffffff' } }

describe('drawing-aware native documents and shared change detection', () => {
  it('round trips the full native scene in a version 3 document and keeps legacy graph shape', () => {
    const serialized = serializeFlow([], [], 'architecture', drawing)
    expect(JSON.parse(serialized).version).toBe(3)
    expect(parseFlowJson(serialized)).toEqual({ nodes: [], edges: [], mode: 'architecture', architectureScene: drawing })
    expect(JSON.parse(serializeFlow([], [], 'flowchart')).version).toBe(2)
    expect(parseFlowJson('{"nodes":[],"edges":[]}')).toEqual({ nodes: [], edges: [], mode: 'flowchart' })
  })

  it('detects scene-only changes including geometry and assets', () => {
    const original = flowToChart([], [], drawing)
    expect(original.architectureScene).toEqual(drawing)
    const edited = structuredClone(drawing)
    edited.elements[0].angle = 1
    expect(contentFingerprint(original)).not.toEqual(contentFingerprint(flowToChart([], [], edited)))
    expect(contentFingerprint(original)).not.toEqual(contentFingerprint(flowToChart([], [])))
    expect(contentFingerprint(original)).toEqual(contentFingerprint(flowToChart([], [], structuredClone(drawing))))
  })

  it('rejects a corrupt embedded drawing instead of silently opening only the graph', () => {
    const invalid = JSON.stringify({ nodes: [], edges: [], architectureScene: { ...drawing, version: 99 } })
    expect(() => parseFlowJson(invalid)).toThrow('version')
  })
})
