import { describe, expect, it } from 'vitest'
import { serializeFlow, parseFlowJson } from '../utils/exportUtils'
import { contentFingerprint, flowToChart } from '../utils/sharedFlow'
import type { ArchitectureScene } from '../shared/architectureScene'
import { inferDiagramMode, isDiagramMode } from '../shared/flowTypes'

const drawing: ArchitectureScene = { version: 1, elements: [{ id: 'pen', type: 'freedraw', x: -40, y: 5, width: 100, height: 60, angle: 0, points: [[0, 0], [40, 60], [100, 10]], pressures: [0.5, 0.6, 0.4], strokeColor: '#099268', groupIds: ['group'] }], files: {}, appState: { viewBackgroundColor: '#ffffff' } }

describe('drawing-aware native documents and shared change detection', () => {
  it('round trips the full drawing in version 4 while retaining the chosen graph view', () => {
    const serialized = serializeFlow([], [], 'architecture', drawing)
    expect(JSON.parse(serialized).version).toBe(4)
    expect(parseFlowJson(serialized)).toEqual({ nodes: [], edges: [], mode: 'architecture', architectureScene: drawing })
    expect(JSON.parse(serializeFlow([], [], 'flowchart')).version).toBe(2)
    expect(JSON.parse(serializeFlow([], [], 'architecture')).version).toBe(2)
    expect(parseFlowJson('{"nodes":[],"edges":[]}')).toEqual({ nodes: [], edges: [], mode: 'flowchart' })
  })


  it('exports an empty Draw document with an explicit version 4 mode', () => {
    const serialized = serializeFlow([], [], 'draw')
    expect(JSON.parse(serialized)).toEqual({ version: 4, mode: 'draw', nodes: [], edges: [] })
    expect(parseFlowJson(serialized)).toEqual({ nodes: [], edges: [], mode: 'draw' })
  })

  it('migrates version 3 drawings without changing geometry or explicit Flowchart views', () => {
    const legacy = { version: 3, mode: 'architecture', nodes: [], edges: [], architectureScene: drawing }
    expect(parseFlowJson(JSON.stringify(legacy))).toEqual({ nodes: [], edges: [], mode: 'draw', architectureScene: drawing })
    expect(parseFlowJson(JSON.stringify({ ...legacy, mode: 'flowchart' }))).toEqual({ nodes: [], edges: [], mode: 'flowchart', architectureScene: drawing })
    const current = { ...legacy, version: 4 }
    expect(parseFlowJson(JSON.stringify(current))).toEqual({ nodes: [], edges: [], mode: 'architecture', architectureScene: drawing })
  })

  it('infers old documents from content while respecting explicit modes', () => {
    const semantic = { id: 'service', type: 'service', position: { x: 10, y: 20 }, data: { label: 'API' } }
    const graph = { nodes: [semantic], edges: [] }
    expect(parseFlowJson(JSON.stringify(graph)).mode).toBe('architecture')
    expect(parseFlowJson(JSON.stringify({ ...graph, architectureScene: drawing })).mode).toBe('draw')
    expect(parseFlowJson(JSON.stringify({ ...graph, mode: 'flowchart', architectureScene: drawing })).mode).toBe('flowchart')
    expect(inferDiagramMode({ nodes: [{ type: 'step' }] })).toBe('flowchart')
    expect(inferDiagramMode({ nodes: [{ type: 'container' }] })).toBe('architecture')
    expect(inferDiagramMode({ mode: 'draw', nodes: [] })).toBe('draw')
    expect(isDiagramMode('draw')).toBe(true)
    expect(isDiagramMode('future-editor')).toBe(false)
  })

  it('detects mode-only changes and normalizes implicit legacy views in fingerprints', () => {
    const implicitDraw = flowToChart([], [], drawing)
    const explicitDraw = flowToChart([], [], drawing, 'draw')
    const architecture = flowToChart([], [], drawing, 'architecture')
    expect(contentFingerprint(implicitDraw)).toBe(contentFingerprint(explicitDraw))
    expect(contentFingerprint(explicitDraw)).not.toBe(contentFingerprint(architecture))
    expect(contentFingerprint(architecture)).not.toBe(contentFingerprint(flowToChart([], [], drawing, 'flowchart')))
    const semantic = [{ id: 'service', type: 'service', position: { x: 0, y: 0 }, data: { label: 'API' } }]
    expect(contentFingerprint(flowToChart(semantic, []))).toBe(contentFingerprint(flowToChart(semantic, [], undefined, 'architecture')))
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
